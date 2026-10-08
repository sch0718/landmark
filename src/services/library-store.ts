import { Clock, Context, Effect, Exit, Layer, Result, Stream } from 'effect';
import { createMemoryStorage, isStorageAvailable } from 'src/repositories/edit-layer-repo';
import { emptyLibrary, LIBRARY_LIMITS, LibrarySchema, type Library } from 'src/schema/library';
import { safeParse, type Issue } from 'src/schema/parse';
import { browserStorage } from 'src/services/browser-storage';
import { LibraryCorrupt, LibraryInvalid, StorageQuotaExceeded } from 'src/services/errors';

/** 보관함 문서의 저장 키(스펙 §3). */
export const LIBRARY_KEY = 'tripmap:library:v2';
/** Web Locks 이름. 저장 키와 같다. */
export const LIBRARY_LOCK = 'tripmap:library:v2';
/** 손상된 문서의 원문을 보관하는 키. */
export const corruptKey = (iso: string): string => `tripmap:library:v2:corrupt-${iso}`;

export type LoadResult = { library: Library; persistence: 'local' | 'memory' };

export type LibraryLimits = { libraryChars: number };

type UpdateError = StorageQuotaExceeded | LibraryInvalid | LibraryCorrupt;

export type LibraryStoreOptions = {
  /** 없거나 쓸 수 없으면 메모리 저장소로 대체하고 `persistence: 'memory'`를 보고한다. */
  storage: Storage | undefined;
  /** 없으면 잠금 없이 같은 순서로 실행한다. */
  locks?: LockManager;
  /** `storage` 이벤트를 받을 대상. 없으면 `changes`는 비어 있다. */
  events?: EventTarget;
  /** 테스트에서 한도를 낮추는 용도. */
  limits?: Partial<LibraryLimits>;
};

const isQuotaError = (error: unknown): boolean =>
  error instanceof DOMException &&
  (error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    error.code === 22 ||
    error.code === 1014);

type StoredRead = { ok: true; library: Library } | { ok: false; raw: string; issues: Issue[] };

/** 저장소 원문을 보관함 문서로 읽는다. 쓰지 않는다. */
function parseLibrary(raw: string): StoredRead {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'JSON을 읽지 못했어요';
    return { ok: false, raw, issues: [{ path: '', message }] };
  }
  const parsed = safeParse(LibrarySchema, json);
  return parsed.success
    ? { ok: true, library: parsed.data }
    : { ok: false, raw, issues: parsed.issues };
}

/** 키가 없으면 빈 문서. */
function readStored(storage: Storage): StoredRead {
  const raw = storage.getItem(LIBRARY_KEY);
  return raw === null ? { ok: true, library: emptyLibrary() } : parseLibrary(raw);
}

function makeLibraryStore(options: LibraryStoreOptions) {
  const local = isStorageAvailable(options.storage) ? options.storage : undefined;
  const persistence: LoadResult['persistence'] = local === undefined ? 'memory' : 'local';
  const storage = local ?? createMemoryStorage();
  const { locks, events } = options;
  const libraryChars = options.limits?.libraryChars ?? LIBRARY_LIMITS.libraryChars;

  /** 손상된 원문을 백업 키에 복사하고 `LibraryCorrupt`로 실패한다. 원래 키는 건드리지 않는다. */
  const failCorrupt = Effect.fnUntraced(function* (read: Extract<StoredRead, { ok: false }>) {
    const now = yield* Clock.currentTimeMillis;
    const backupKey = corruptKey(new Date(now).toISOString());
    yield* Effect.sync(() => storage.setItem(backupKey, read.raw)).pipe(
      // 백업을 쓰지 못해도(용량 초과 등) 원본은 그대로 남으므로 손상 보고는 계속한다.
      Effect.catchCause(() => Effect.void),
    );
    return yield* new LibraryCorrupt({ backupKey, issues: read.issues });
  });

  const readLatest = Effect.fnUntraced(function* () {
    const read = yield* Effect.sync(() => readStored(storage));
    return read.ok ? read.library : yield* failCorrupt(read);
  });

  /**
   * 잠금 안에서 `eff`를 실행한다. 잠금 콜백은 Promise를 돌려주므로 안쪽 Effect를 `Exit`으로
   * 받아 나온 뒤 다시 던져 오류 채널을 보존한다. LockManager가 없으면 그대로 실행한다.
   */
  const withLock = <A, E>(eff: Effect.Effect<A, E>): Effect.Effect<A, E> => {
    if (locks === undefined) return eff;
    return Effect.gen(function* () {
      const run = Effect.runPromiseExitWith(yield* Effect.context<never>());
      const exit: Exit.Exit<A, E> = yield* Effect.promise(() =>
        locks.request(LIBRARY_LOCK, () => run(eff)),
      );
      return yield* exit;
    });
  };

  const load = Effect.fnUntraced(function* () {
    const library = yield* readLatest();
    return { library, persistence } satisfies LoadResult;
  })();

  const update = Effect.fn('LibraryStore/update')(function* <E>(
    f: (current: Library) => Effect.Effect<Library, E>,
  ) {
    return yield* withLock(
      Effect.gen(function* () {
        const current = yield* readLatest();
        const next = yield* f(current);
        const parsed = safeParse(LibrarySchema, next);
        if (!parsed.success) return yield* new LibraryInvalid({ issues: parsed.issues });
        const serialized = JSON.stringify(parsed.data);
        if (serialized.length > libraryChars) {
          return yield* new StorageQuotaExceeded({ bytes: serialized.length });
        }
        yield* Effect.try({
          try: () => storage.setItem(LIBRARY_KEY, serialized),
          catch: (error) =>
            isQuotaError(error) ? new StorageQuotaExceeded({ bytes: serialized.length }) : error,
        }).pipe(
          // 용량 초과 외의 쓰기 예외는 예상 밖이므로 결함으로 보고한다.
          Effect.catchIf(
            (error): error is unknown => !(error instanceof StorageQuotaExceeded),
            (error) => Effect.die(error),
          ),
        );
        return parsed.data;
      }),
    );
  });

  // 다른 탭이 쓴 값만 온다(같은 탭의 쓰기는 `storage` 이벤트를 만들지 않는다).
  // 검증에 실패한 값은 무시한다. 키가 지워졌으면 빈 문서로 본다(`load`와 같은 의미).
  const changes: Stream.Stream<Library> =
    events === undefined
      ? Stream.empty
      : Stream.fromEventListener<StorageEvent>(events, 'storage').pipe(
          Stream.filterMap((event) => {
            if (event.key !== LIBRARY_KEY) return Result.failVoid;
            if (event.newValue === null) return Result.succeed(emptyLibrary());
            const read = parseLibrary(event.newValue);
            return read.ok ? Result.succeed(read.library) : Result.failVoid;
          }),
        );

  // 손상 백업은 `load`/`update`가 `LibraryCorrupt`를 낼 때 이미 남겼다.
  const resetWithBackup = withLock(
    Effect.sync(() => {
      const library = emptyLibrary();
      storage.setItem(LIBRARY_KEY, JSON.stringify(library));
      return library;
    }),
  );

  return LibraryStore.of({ load, update, changes, resetWithBackup });
}

export class LibraryStore extends Context.Service<
  LibraryStore,
  {
    readonly load: Effect.Effect<LoadResult, LibraryCorrupt>;
    update<E>(
      f: (current: Library) => Effect.Effect<Library, E>,
    ): Effect.Effect<Library, E | UpdateError>;
    readonly changes: Stream.Stream<Library>;
    readonly resetWithBackup: Effect.Effect<Library>;
  }
>()('tripmap/LibraryStore') {
  static layerWith(options: LibraryStoreOptions) {
    return Layer.sync(LibraryStore, () => makeLibraryStore(options));
  }

  static readonly layer = Layer.suspend(() => {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    return LibraryStore.layerWith({
      storage: browserStorage(),
      locks,
      events: typeof window === 'undefined' ? undefined : window,
    });
  });
}
