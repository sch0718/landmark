import { Clock, Context, Effect, Exit, Layer, Result, Stream } from 'effect';
import { createMemoryStorage, PROBE_KEY } from 'src/repositories/edit-layer-repo';
import { emptyLibrary, LIBRARY_LIMITS, LibrarySchema, type Library } from 'src/schema/library';
import { safeParse, type Issue } from 'src/schema/parse';
import { browserStorage } from 'src/services/browser-storage';
import { LibraryCorrupt, LibraryInvalid, StorageQuotaExceeded } from 'src/services/errors';
import { ROUTE_CACHE_KEY } from 'src/services/route-lookup';

/** 보관함 문서의 저장 키(스펙 §3). */
export const LIBRARY_KEY = 'tripmap:library:v2';
/** Web Locks 이름. 저장 키와 같다. */
export const LIBRARY_LOCK = 'tripmap:library:v2';
/** 손상된 문서의 원문을 보관하는 키. */
const CORRUPT_PREFIX = 'tripmap:library:v2:corrupt-';
export const corruptKey = (iso: string): string => `${CORRUPT_PREFIX}${iso}`;

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

/**
 * 시작할 때 저장소를 써 본다. 쓰기가 용량 초과로만 실패하고 읽기가 되면 읽을 수 있는 보관함을 가린 채
 * 빈 메모리 저장소로 바꾸지 않는다(이후 쓰기는 `StorageQuotaExceeded`로 실패해 알려진다).
 * 저장소에 접근하는 것 자체가 막히면 `undefined`(메모리로 대체).
 */
function usableStorage(storage: Storage | undefined): Storage | undefined {
  if (storage === undefined) return undefined;
  try {
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return storage;
  } catch (error) {
    if (!isQuotaError(error)) return undefined;
  }
  try {
    storage.getItem(LIBRARY_KEY);
    return storage;
  } catch {
    return undefined;
  }
}

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
  const local = usableStorage(options.storage);
  const persistence: LoadResult['persistence'] = local === undefined ? 'memory' : 'local';
  const storage = local ?? createMemoryStorage();
  const { locks, events } = options;
  const libraryChars = options.limits?.libraryChars ?? LIBRARY_LIMITS.libraryChars;

  /**
   * `storage.setItem`. 용량 초과면 버려도 되는 경로 캐시(`tripmap:routes:v1`)를 지우고 한 번 더 쓴다.
   * 보관함은 사용자의 데이터이고 경로 캐시는 다시 받으면 된다. 그래도 넘치면 `StorageQuotaExceeded`,
   * 그 밖의 예외는 결함으로 보고한다.
   */
  const putItem = (key: string, value: string): Effect.Effect<void, StorageQuotaExceeded> =>
    Effect.suspend(() => {
      const attempt = (): unknown => {
        try {
          storage.setItem(key, value);
          return null;
        } catch (error) {
          return error ?? new Error('setItem 실패');
        }
      };
      // 경로 캐시를 지우는 길에서 저장소가 던지면 처음 쿼터 오류를 그대로 낸다.
      const dropRouteCache = (): boolean => {
        try {
          if (storage.getItem(ROUTE_CACHE_KEY) === null) return false;
          storage.removeItem(ROUTE_CACHE_KEY);
          return true;
        } catch {
          return false;
        }
      };
      let error = attempt();
      if (error !== null && isQuotaError(error) && dropRouteCache()) error = attempt();
      if (error === null) return Effect.void;
      return isQuotaError(error)
        ? Effect.fail(new StorageQuotaExceeded({ bytes: value.length }))
        : Effect.die(error);
    });

  /** 원문과 똑같은 값을 가진 기존 백업 키. 없으면 `null`. */
  const findBackup = (raw: string): string | null => {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(CORRUPT_PREFIX) && storage.getItem(key) === raw) return key;
    }
    return null;
  };

  /** 같은 원문의 백업이 있으면 그 키를, 없으면 새로 써서 그 키를 돌려준다. */
  const ensureBackup = Effect.fnUntraced(function* (raw: string) {
    const existing = findBackup(raw);
    if (existing !== null) return existing;
    const now = yield* Clock.currentTimeMillis;
    const base = corruptKey(new Date(now).toISOString());
    // 같은 밀리초에 다른 백업이 있으면 덮어쓰지 않도록 번호를 붙인다.
    let key = base;
    for (let n = 2; storage.getItem(key) !== null; n++) key = `${base}-${n}`;
    yield* putItem(key, raw);
    return key;
  });

  type Corrupt = Extract<StoredRead, { ok: false }>;

  /** `load`: 백업을 (없으면) 남기고 `LibraryCorrupt`로 실패한다. 백업을 못 쓰면 `backupKey`는 `null`. */
  const failCorruptWithBackup = Effect.fnUntraced(function* (read: Corrupt) {
    const backupKey = yield* ensureBackup(read.raw).pipe(
      Effect.catchTag('StorageQuotaExceeded', () => Effect.succeed(null)),
    );
    return yield* new LibraryCorrupt({ backupKey, issues: read.issues });
  });

  /** `update`: 아무것도 쓰지 않는다. `backupKey`는 이미 있는 백업 키 또는 `null`. */
  const failCorruptReadOnly = Effect.fnUntraced(function* (read: Corrupt) {
    const backupKey = findBackup(read.raw);
    return yield* new LibraryCorrupt({ backupKey, issues: read.issues });
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
    const read = yield* Effect.sync(() => readStored(storage));
    if (!read.ok) return yield* failCorruptWithBackup(read);
    return { library: read.library, persistence } satisfies LoadResult;
  })();

  const update = Effect.fn('LibraryStore/update')(function* <E>(
    f: (current: Library) => Effect.Effect<Library, E>,
  ) {
    return yield* withLock(
      Effect.gen(function* () {
        const read = yield* Effect.sync(() => readStored(storage));
        if (!read.ok) return yield* failCorruptReadOnly(read);
        const current = read.library;
        const next = yield* f(current);
        const parsed = safeParse(LibrarySchema, next);
        if (!parsed.success) return yield* new LibraryInvalid({ issues: parsed.issues });
        const serialized = JSON.stringify(parsed.data);
        if (serialized.length > libraryChars) {
          return yield* new StorageQuotaExceeded({ bytes: serialized.length });
        }
        yield* putItem(LIBRARY_KEY, serialized);
        return parsed.data;
      }),
    );
  });

  // 메모리 모드에서는 비어 있다(창의 저장소 이벤트는 이 저장소와 무관하다).
  // 다른 탭이 쓴 값만 온다(같은 탭의 쓰기는 `storage` 이벤트를 만들지 않는다).
  // 검증에 실패한 값은 무시한다. 키가 지워졌으면 빈 문서로 본다(`load`와 같은 의미).
  const changes: Stream.Stream<Library> =
    events === undefined || persistence === 'memory'
      ? Stream.empty
      : Stream.fromEventListener<StorageEvent>(events, 'storage').pipe(
          Stream.filterMap((event) => {
            if (event.key !== LIBRARY_KEY) return Result.failVoid;
            if (event.newValue === null) return Result.succeed(emptyLibrary());
            const read = parseLibrary(event.newValue);
            return read.ok ? Result.succeed(read.library) : Result.failVoid;
          }),
        );

  // 잠금 안에서 키를 다시 읽는다. 정상이거나 없으면 그대로 돌려주고 쓰지 않는다(다른 탭이 이미 복구했을
  // 수 있다). 손상이면 똑같은 원문의 백업을 확보한 뒤에만 빈 문서로 덮어쓴다.
  const resetWithBackup = withLock(
    Effect.gen(function* () {
      const read = yield* Effect.sync(() => readStored(storage));
      if (read.ok) return read.library;
      yield* ensureBackup(read.raw);
      const library = emptyLibrary();
      yield* putItem(LIBRARY_KEY, JSON.stringify(library));
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
    readonly resetWithBackup: Effect.Effect<Library, StorageQuotaExceeded>;
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
