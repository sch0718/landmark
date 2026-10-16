import { Clock, Context, Effect, Exit, Layer, Result, Stream } from 'effect';
import { hasAnyEntry } from 'src/domain/backup/summary';
import { createMemoryStorage, PROBE_KEY } from 'src/repositories/edit-layer-repo';
import { BACKUP_FORMAT, BACKUP_VERSION, BackupEnvelopeSchema } from 'src/schema/backup';
import { emptyLibrary, LIBRARY_LIMITS, LibrarySchema, type Library } from 'src/schema/library';
import { safeParse, type Issue } from 'src/schema/parse';
import { browserStorage } from 'src/services/browser-storage';
import {
  LibraryCorrupt,
  LibraryInvalid,
  NoPrevious,
  PreviousNotKept,
  StorageQuotaExceeded,
} from 'src/services/errors';
import { ROUTE_CACHE_KEY } from 'src/services/route-lookup';

/** 보관함 문서의 저장 키(스펙 §3). */
export const LIBRARY_KEY = 'tripmap:library:v2';
/** Web Locks 이름. 저장 키와 같다. */
export const LIBRARY_LOCK = 'tripmap:library:v2';
/** 손상된 문서의 원문을 보관하는 키. */
const CORRUPT_PREFIX = 'tripmap:library:v2:corrupt-';
export const corruptKey = (iso: string): string => `${CORRUPT_PREFIX}${iso}`;
/**
 * 되살리기 전 사본(한 벌, 설계서 §3.3). 값은 백업 파일과 같은 봉투다. 손상 백업 접두사로 시작하지 않으므로
 * `findBackup`이 손상 백업으로 보지 않는다.
 */
export const PREVIOUS_KEY = 'tripmap:library:v2:before-restore';

export type LoadResult = { library: Library; persistence: 'local' | 'memory' };

export type LibraryLimits = { libraryChars: number };

type UpdateError = StorageQuotaExceeded | LibraryInvalid | LibraryCorrupt;

/** `snapshot`: `raw`는 저장소 원문의 JSON 값(모르는 필드 포함), `text`는 원문 문자열(키 없으면 `null`). */
type LibrarySnapshot = { raw: unknown; text: string | null; library: Library };

/**
 * `replace`의 선택(설계서 §5). `requirePrevious`: 사본을 못 남기면 바꾸지 않는다.
 * `savedText`: 화면이 이미 파일로 받아 둔(또는 연 때 읽은) 원문. 잠금 안의 지금 원문과 다르면 사본이 필수가 된다.
 */
type ReplaceOptions = { requirePrevious: boolean; savedText?: string | null };

type PreviousCopy = { savedAt: string; library: Library };

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

/** `json`은 원문의 JSON 값(검증 전, 모르는 필드 포함). 키가 없으면 빈 문서. */
type StoredRead =
  { ok: true; library: Library; json: unknown } | { ok: false; raw: string; issues: Issue[] };

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
    ? { ok: true, library: parsed.data, json }
    : { ok: false, raw, issues: parsed.issues };
}

/** 저장소에서 읽은 원문 문자열(`null`이면 키 없음)을 읽는다. 키가 없으면 빈 문서. */
function readText(text: string | null): StoredRead {
  return text === null
    ? { ok: true, library: emptyLibrary(), json: emptyLibrary() }
    : parseLibrary(text);
}

function readStored(storage: Storage): StoredRead {
  return readText(storage.getItem(LIBRARY_KEY));
}

/** 사본을 봉투 → 보관함 순서로 읽는다. 없거나 읽지 못하면 `null`(지우지 않는다). */
function readPrevious(storage: Storage): PreviousCopy | null {
  const text = storage.getItem(PREVIOUS_KEY);
  if (text === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const envelope = safeParse(BackupEnvelopeSchema, json);
  if (!envelope.success) return null;
  const library = safeParse(LibrarySchema, envelope.data.library);
  return library.success ? { savedAt: envelope.data.exportedAt, library: library.data } : null;
}

function makeLibraryStore(options: LibraryStoreOptions) {
  const local = usableStorage(options.storage);
  const persistence: LoadResult['persistence'] = local === undefined ? 'memory' : 'local';
  const storage = local ?? createMemoryStorage();
  const { locks, events } = options;
  const libraryChars = options.limits?.libraryChars ?? LIBRARY_LIMITS.libraryChars;

  /**
   * `storage.setItem`. 용량 초과면 버려도 되는 경로 캐시(`tripmap:routes:v1`)를 지우고 한 번 더 쓴다.
   * 보관함은 사용자의 데이터이고 경로 캐시는 다시 받으면 된다. 그래도 넘치면 되살리기 전 사본을 지우고
   * 한 번 더 쓴다(사용자 편집을 저장하는 것이 사본보다 중요하다, 설계서 §3.3). 사본을 쓰는 중이거나
   * `keepPrevious`(바꾸기·되돌리기 도중, 사본을 직접 다룬다)면 사본은 건드리지 않는다.
   * 그래도 넘치면 `StorageQuotaExceeded`, 그 밖의 예외는 결함으로 보고한다.
   */
  const putItem = (
    key: string,
    value: string,
    options: { keepPrevious?: boolean } = {},
  ): Effect.Effect<void, StorageQuotaExceeded> =>
    Effect.suspend(() => {
      const attempt = (): unknown => {
        try {
          storage.setItem(key, value);
          return null;
        } catch (error) {
          return error ?? new Error('setItem 실패');
        }
      };
      // 지우는 길에서 저장소가 던지면 처음 쿼터 오류를 그대로 낸다.
      const drop = (dropKey: string): boolean => {
        try {
          if (storage.getItem(dropKey) === null) return false;
          storage.removeItem(dropKey);
          return true;
        } catch {
          return false;
        }
      };
      const mayDropPrevious = key !== PREVIOUS_KEY && options.keepPrevious !== true;
      let error = attempt();
      if (error !== null && isQuotaError(error) && drop(ROUTE_CACHE_KEY)) error = attempt();
      if (error !== null && isQuotaError(error) && mayDropPrevious && drop(PREVIOUS_KEY)) {
        error = attempt();
      }
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
  const ensureBackup = Effect.fnUntraced(function* (
    raw: string,
    putOptions: { keepPrevious?: boolean } = {},
  ) {
    const existing = findBackup(raw);
    if (existing !== null) return existing;
    const now = yield* Clock.currentTimeMillis;
    const base = corruptKey(new Date(now).toISOString());
    // 같은 밀리초에 다른 백업이 있으면 덮어쓰지 않도록 번호를 붙인다.
    let key = base;
    for (let n = 2; storage.getItem(key) !== null; n++) key = `${base}-${n}`;
    yield* putItem(key, raw, putOptions);
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

  // 잠금 없이 읽기만 한다. 손상이면 `update`처럼 아무것도 쓰지 않고 실패한다.
  const snapshot = Effect.gen(function* () {
    const text = yield* Effect.sync(() => storage.getItem(LIBRARY_KEY));
    const read = readText(text);
    if (!read.ok) return yield* failCorruptReadOnly(read);
    return { raw: read.json, text, library: read.library } satisfies LibrarySnapshot;
  });

  const KEEP_PREVIOUS = { keepPrevious: true } as const;

  /** 쓰면 `true`, 용량 초과면 `false`. */
  const fits = <A>(write: Effect.Effect<A, StorageQuotaExceeded>) =>
    write.pipe(
      Effect.as(true),
      Effect.catchTag('StorageQuotaExceeded', () => Effect.succeed(false)),
    );

  const removePrevious = Effect.sync(() => storage.removeItem(PREVIOUS_KEY));

  // 설계서 §5의 순서(잠금 안): 지금 원문 읽기 → 사본 필수 여부 → `next` 검증·크기(실패면 아무것도 쓰지
  // 않음) → 사본 쓰기(정상이고 항목이 있을 때) 또는 손상 백업 확보(손상일 때) → 보관함 쓰기.
  // `setItem` 실패는 원래 값을 남기므로 어느 실패에서도 지금 보관함은 그대로다.
  const replace = Effect.fn('LibraryStore/replace')(function* (
    next: Library,
    options: ReplaceOptions,
  ) {
    return yield* withLock(
      Effect.gen(function* () {
        const current = yield* Effect.sync(() => storage.getItem(LIBRARY_KEY));
        const { requirePrevious, savedText } = options;
        // 받아 둔 원문이 지금과 다르면 그 받기(또는 빈 보관함)는 없었던 것으로 본다.
        const mustKeep = requirePrevious || (savedText !== undefined && savedText !== current);
        const notKept = () => new PreviousNotKept({ changedSinceSaved: !requirePrevious });

        const parsed = safeParse(LibrarySchema, next);
        if (!parsed.success) return yield* new LibraryInvalid({ issues: parsed.issues });
        const serialized = JSON.stringify(parsed.data);
        if (serialized.length > libraryChars) {
          return yield* new StorageQuotaExceeded({ bytes: serialized.length });
        }
        const done = (previousKept: boolean) => ({ library: parsed.data, previousKept });

        const read = readText(current);
        if (!read.ok) {
          // 손상: 원문을 손상 백업 키에 확보한다(사본 키는 건드리지 않는다).
          const backedUp = yield* fits(ensureBackup(read.raw, KEEP_PREVIOUS));
          if (!backedUp && mustKeep) return yield* notKept();
          yield* putItem(LIBRARY_KEY, serialized, KEEP_PREVIOUS);
          return done(false);
        }

        if (!hasAnyEntry(read.library)) {
          // 바꾸기 직전 보관함이 비어 있으면 남길 것이 없다. 옛 사본도 지운다(사본은 "바꾸기 직전 상태").
          yield* removePrevious;
          yield* putItem(LIBRARY_KEY, serialized, KEEP_PREVIOUS);
          return done(false);
        }

        const now = yield* Clock.currentTimeMillis;
        const envelope = JSON.stringify({
          format: BACKUP_FORMAT,
          v: BACKUP_VERSION,
          exportedAt: new Date(now).toISOString(),
          library: read.json,
        });
        if (!(yield* fits(putItem(PREVIOUS_KEY, envelope)))) {
          if (mustKeep) return yield* notKept();
          // 옛 사본은 바꾸기 직전 상태가 아니므로 지운다.
          yield* removePrevious;
          yield* putItem(LIBRARY_KEY, serialized, KEEP_PREVIOUS);
          return done(false);
        }
        if (yield* fits(putItem(LIBRARY_KEY, serialized, KEEP_PREVIOUS))) return done(true);
        // 방금 쓴 사본을 지워 자리를 낸다(옛 사본은 이미 덮어썼다, 한 벌 규칙).
        yield* removePrevious;
        if (mustKeep) return yield* notKept();
        yield* putItem(LIBRARY_KEY, serialized, KEEP_PREVIOUS);
        return done(false);
      }),
    );
  });

  const previous = Effect.sync(() => readPrevious(storage));

  // 잠금 안에서 사본을 다시 읽어 그 보관함을 쓰고 사본을 지운다(되돌리기는 한 번뿐).
  // 지금 문서가 손상이면 그 원문을 먼저 손상 백업에 확보한다.
  const restorePrevious = withLock(
    Effect.gen(function* () {
      const saved = yield* Effect.sync(() => readPrevious(storage));
      if (saved === null) return yield* new NoPrevious();
      const read = yield* Effect.sync(() => readStored(storage));
      if (!read.ok) yield* ensureBackup(read.raw, KEEP_PREVIOUS);
      yield* putItem(LIBRARY_KEY, JSON.stringify(saved.library), KEEP_PREVIOUS);
      yield* removePrevious;
      return saved.library;
    }),
  );

  return LibraryStore.of({
    load,
    update,
    changes,
    resetWithBackup,
    snapshot,
    replace,
    previous,
    restorePrevious,
    dropPrevious: removePrevious,
  });
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
    readonly snapshot: Effect.Effect<LibrarySnapshot, LibraryCorrupt>;
    replace(
      next: Library,
      options: ReplaceOptions,
    ): Effect.Effect<
      { library: Library; previousKept: boolean },
      StorageQuotaExceeded | LibraryInvalid | PreviousNotKept
    >;
    /** 사본. 없거나 읽지 못하면 `null`. `savedAt`은 사본을 만든 시각. */
    readonly previous: Effect.Effect<PreviousCopy | null>;
    readonly restorePrevious: Effect.Effect<
      Library,
      StorageQuotaExceeded | LibraryInvalid | NoPrevious
    >;
    readonly dropPrevious: Effect.Effect<void>;
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
