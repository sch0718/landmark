import { describe, expect, it as vitestIt } from 'vitest';
import { it } from '@effect/vitest';
import { Effect, Fiber, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { setPlaceMemo, type OpCtx } from 'src/domain/library/ops';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { BACKUP_FORMAT, BACKUP_VERSION } from 'src/schema/backup';
import { emptyLibrary, LIBRARY_LIMITS, type Library, type Place } from 'src/schema/library';
import {
  LabelNameTaken,
  LegacyImportInvalid,
  LegacyImportStale,
  LibraryCorrupt,
  LibraryInvalid,
  NoPrevious,
  PreviousNotKept,
  StorageQuotaExceeded,
  StorageUnavailable,
} from 'src/services/errors';
import {
  corruptKey,
  LIBRARY_KEY,
  LIBRARY_LOCK,
  LibraryStore,
  PREVIOUS_KEY,
  type LibraryStoreOptions,
} from 'src/services/library-store';
import { ROUTE_CACHE_KEY } from 'src/services/route-lookup';
import { createHeldLocks } from '../../fixtures/fake-locks';

const T0 = '2026-10-08T01:00:00.000Z';
const NOW = '2026-10-08T02:00:00.000Z';
const P1 = 'place00001';
const P2 = 'place00002';
const ctx: OpCtx = { now: NOW, newId: () => 'unused0001' };

const f = <V>(value: V) => ({ value, updatedAt: T0 });

function place(id: string, over: Partial<Place> = {}): Place {
  return {
    id,
    source: { kind: 'naver', sid: id.replace(/\D/g, '') || '1' },
    name: f(`장소 ${id}`),
    address: '강원특별자치도 강릉시 난설헌로 131',
    lng: 128.95,
    lat: 37.77,
    category: f<string | null>(null),
    labelIds: f<string[]>([]),
    memo: f(''),
    saved: f(true),
    createdAt: T0,
    deletedAt: null,
    ...over,
  };
}

const libraryOf = (...places: Place[]): Library => ({
  ...emptyLibrary(),
  places: Object.fromEntries(places.map((p) => [p.id, p])),
});

const seed = (storage: Storage, library: Library): string => {
  const raw = JSON.stringify(library);
  storage.setItem(LIBRARY_KEY, raw);
  return raw;
};

/** `setItem` 호출을 기록한다(프로브 이후의 쓰기만 보려면 호출 직후에 만든다). */
function spyWrites(storage: Storage): string[] {
  const writes: string[] = [];
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key: string, value: string) => {
    if (key !== 'tripmap:probe') writes.push(key);
    setItem(key, value);
  };
  return writes;
}

const corruptKeys = (storage: Storage): string[] =>
  Array.from({ length: storage.length }, (_, i) => storage.key(i)!).filter((k) =>
    k.startsWith('tripmap:library:v2:corrupt-'),
  );

const withStore = <A, E>(
  options: LibraryStoreOptions,
  use: (store: LibraryStore['Service']) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    return yield* use(store);
  }).pipe(Effect.provide(LibraryStore.layerWith(options)));

describe('LibraryStore.load', () => {
  it.effect('load returns empty library without writing when key missing', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const result = yield* withStore({ storage }, (s) => s.load);
      expect(result).toEqual({ library: emptyLibrary(), persistence: 'local' });
      expect(storage.length).toBe(0);
    }),
  );

  it.effect('reads and validates a stored document', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const library = libraryOf(place(P1));
      seed(storage, library);
      const result = yield* withStore({ storage }, (s) => s.load);
      expect(result.library).toEqual(library);
    }),
  );

  it.effect('backs up corrupt document and fails with LibraryCorrupt', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(LIBRARY_KEY, '{bad');
      const error = yield* withStore({ storage }, (s) => Effect.flip(s.load));
      expect(error._tag).toBe('LibraryCorrupt');
      expect(error.backupKey?.startsWith('tripmap:library:v2:corrupt-')).toBe(true);
      expect(error.issues.length).toBeGreaterThan(0);
      expect(storage.getItem(error.backupKey!)).toBe('{bad');
      expect(storage.getItem(LIBRARY_KEY)).toBe('{bad');
    }),
  );

  it.effect('treats a schema-invalid document as corrupt too', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const raw = JSON.stringify({ schemaVersion: 1, places: {} });
      storage.setItem(LIBRARY_KEY, raw);
      const error = yield* withStore({ storage }, (s) => Effect.flip(s.load));
      expect(error._tag).toBe('LibraryCorrupt');
      expect(storage.getItem(error.backupKey!)).toBe(raw);
      expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
    }),
  );

  it.effect('resetWithBackup replaces the corrupt key with an empty library', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(LIBRARY_KEY, '{bad');
      const library = yield* withStore({ storage }, (s) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(s.load);
          const reset = yield* s.resetWithBackup;
          expect(storage.getItem(error.backupKey!)).toBe('{bad');
          return reset;
        }),
      );
      expect(library).toEqual(emptyLibrary());
      expect(storage.getItem(LIBRARY_KEY)).toBe(JSON.stringify(emptyLibrary()));
    }),
  );

  it.effect('repeated load of the same corrupt raw creates only one backup', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(LIBRARY_KEY, '{bad');
      const keys = yield* withStore({ storage }, (s) =>
        Effect.gen(function* () {
          const first = yield* Effect.flip(s.load);
          const second = yield* Effect.flip(s.load);
          return [first.backupKey, second.backupKey];
        }),
      );
      expect(keys[0]).not.toBeNull();
      expect(keys[1]).toBe(keys[0]);
      expect(corruptKeys(storage)).toEqual([keys[0]]);
    }),
  );

  it.effect('load reports backupKey null when the backup cannot be written', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(LIBRARY_KEY, '{bad');
      const setItem = storage.setItem.bind(storage);
      storage.setItem = (key: string, value: string) => {
        if (key.startsWith('tripmap:library:v2:corrupt-')) {
          throw new DOMException('', 'QuotaExceededError');
        }
        setItem(key, value);
      };
      const error = yield* withStore({ storage }, (s) => Effect.flip(s.load));
      expect(error).toBeInstanceOf(LibraryCorrupt);
      expect(error.backupKey).toBeNull();
      expect(corruptKeys(storage)).toEqual([]);
      expect(storage.getItem(LIBRARY_KEY)).toBe('{bad');
    }),
  );

  it.effect('resetWithBackup on a valid document writes nothing and returns it', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const library = libraryOf(place(P1));
      const raw = seed(storage, library);
      const writes = spyWrites(storage);
      const reset = yield* withStore({ storage }, (s) => s.resetWithBackup);
      expect(reset).toEqual(library);
      expect(writes).toEqual([]);
      expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
    }),
  );

  it.effect('resetWithBackup on a missing key writes nothing', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const writes = spyWrites(storage);
      const reset = yield* withStore({ storage }, (s) => s.resetWithBackup);
      expect(reset).toEqual(emptyLibrary());
      expect(writes).toEqual([]);
      expect(storage.getItem(LIBRARY_KEY)).toBeNull();
    }),
  );

  it.effect('resetWithBackup backs up a different corrupt document before overwriting', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(LIBRARY_KEY, '{first');
      yield* withStore({ storage }, (s) => Effect.flip(s.load));
      // 다른 탭이 다른 손상 문서를 남겼다(이 탭은 아직 모른다).
      storage.setItem(LIBRARY_KEY, '{second');
      const reset = yield* withStore({ storage }, (s) => s.resetWithBackup);
      expect(reset).toEqual(emptyLibrary());
      expect(storage.getItem(LIBRARY_KEY)).toBe(JSON.stringify(emptyLibrary()));
      expect(
        corruptKeys(storage)
          .map((k) => storage.getItem(k))
          .sort(),
      ).toEqual(['{first', '{second']);
    }),
  );

  it.effect('resetWithBackup does not overwrite when the backup cannot be written', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(LIBRARY_KEY, '{bad');
      const setItem = storage.setItem.bind(storage);
      storage.setItem = (key: string, value: string) => {
        if (key.startsWith('tripmap:library:v2:corrupt-')) {
          throw new DOMException('', 'QuotaExceededError');
        }
        setItem(key, value);
      };
      const error = yield* withStore({ storage }, (s) => Effect.flip(s.resetWithBackup));
      expect(error).toBeInstanceOf(StorageQuotaExceeded);
      expect(storage.getItem(LIBRARY_KEY)).toBe('{bad');
    }),
  );

  it.effect('a stale recovery screen does not wipe a document recovered in another tab', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const held = createHeldLocks();
      storage.setItem(LIBRARY_KEY, '{bad');
      const options = { storage, locks: held.locks };
      const tabA = yield* withStore(options, (s) => Effect.succeed(s));
      const tabB = yield* withStore(options, (s) => Effect.succeed(s));
      yield* Effect.flip(tabA.load);
      yield* Effect.flip(tabB.load);
      yield* tabA.resetWithBackup;
      yield* tabA.update((lib) => Effect.succeed({ ...lib, places: { [P1]: place(P1) } }));
      const result = yield* tabB.resetWithBackup;
      expect(Object.keys(result.places)).toEqual([P1]);
      expect(Object.keys((JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library).places)).toEqual([
        P1,
      ]);
    }),
  );

  it.effect('falls back to memory when storage throws', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem = () => {
        throw new DOMException('denied', 'SecurityError');
      };
      const next = libraryOf(place(P1));
      yield* withStore({ storage }, (s) =>
        Effect.gen(function* () {
          expect((yield* s.load).persistence).toBe('memory');
          yield* s.update(() => Effect.succeed(next));
          const again = yield* s.load;
          expect(again).toEqual({ library: next, persistence: 'memory' });
        }),
      );
    }),
  );

  it.effect('keeps reading a full storage: quota on the startup probe is not "unavailable"', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const library = libraryOf(...[1, 2, 3, 4, 5].map((n) => place(`place0000${n}`)));
      const raw = seed(storage, library);
      storage.setItem = () => {
        throw new DOMException('', 'QuotaExceededError');
      };
      yield* withStore({ storage }, (s) =>
        Effect.gen(function* () {
          const loaded = yield* s.load;
          expect(loaded.persistence).toBe('local');
          expect(Object.keys(loaded.library.places)).toHaveLength(5);
          const error = yield* Effect.flip(s.update((lib) => Effect.succeed(lib)));
          expect(error).toBeInstanceOf(StorageQuotaExceeded);
        }),
      );
      expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
    }),
  );

  it.effect('falls back to memory when reading the storage throws', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      seed(storage, libraryOf(place(P1)));
      storage.setItem = () => {
        throw new DOMException('', 'QuotaExceededError');
      };
      storage.getItem = () => {
        throw new DOMException('denied', 'SecurityError');
      };
      const result = yield* withStore({ storage }, (s) => s.load);
      expect(result.persistence).toBe('memory');
    }),
  );

  it.effect('falls back to memory when storage is undefined', () =>
    Effect.gen(function* () {
      const result = yield* withStore({ storage: undefined }, (s) => s.load);
      expect(result.persistence).toBe('memory');
    }),
  );
});

describe('LibraryStore.update', () => {
  it.effect('update re-reads latest inside lock', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const held = createHeldLocks();
      const direct = libraryOf(place(P1));
      yield* withStore({ storage, locks: held.locks }, (s) =>
        Effect.gen(function* () {
          yield* s.load;
          seed(storage, direct);
          const result = yield* s.update((current) => Effect.succeed(current));
          expect(result).toEqual(direct);
        }),
      );
      expect(held.requested).toEqual([LIBRARY_LOCK]);
    }),
  );

  it.effect('stale tabs keep both edits', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const held = createHeldLocks();
      seed(storage, libraryOf(place(P1), place(P2)));
      const options = { storage, locks: held.locks };
      const tabA = yield* withStore(options, (s) => Effect.succeed(s));
      const tabB = yield* withStore(options, (s) => Effect.succeed(s));
      // 두 탭 모두 같은 옛 문서를 읽은 뒤 서로 다른 장소를 고친다.
      yield* tabA.load;
      yield* tabB.load;
      yield* tabA.update((lib) => Effect.succeed(setPlaceMemo(lib, P1, '메모 A', ctx)));
      yield* tabB.update((lib) => Effect.succeed(setPlaceMemo(lib, P2, '메모 B', ctx)));
      const stored = JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library;
      expect(stored.places[P1]!.memo.value).toBe('메모 A');
      expect(stored.places[P2]!.memo.value).toBe('메모 B');
    }),
  );

  it.effect('visitedOn·review가 있는 문서를 메모만 고쳐도 두 필드가 그대로 저장된다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const held = createHeldLocks();
      const visitedOn = f<string | null>('2026-10-12');
      const review = f('일출이 좋음');
      seed(storage, libraryOf(place(P1, { visitedOn, review })));
      yield* withStore({ storage, locks: held.locks }, (s) =>
        Effect.gen(function* () {
          yield* s.load;
          yield* s.update((lib) => Effect.succeed(setPlaceMemo(lib, P1, '메모', ctx)));
        }),
      );
      const stored = JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library;
      expect(stored.places[P1]!.memo.value).toBe('메모');
      expect(stored.places[P1]!.visitedOn).toEqual(visitedOn);
      expect(stored.places[P1]!.review).toEqual(review);
    }),
  );

  vitestIt('waits for a held lock before reading and running f', async () => {
    const storage = createMemoryStorage();
    const held = createHeldLocks();
    const raw = seed(storage, libraryOf(place(P1)));
    let ran = false;
    held.hold();
    const pending = Effect.runPromise(
      withStore({ storage, locks: held.locks }, (s) =>
        s.update((lib) => {
          ran = true;
          return Effect.succeed(setPlaceMemo(lib, P1, '잠금 뒤', ctx));
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ran).toBe(false);
    expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
    held.release();
    const result = await pending;
    expect(ran).toBe(true);
    expect(result.places[P1]!.memo.value).toBe('잠금 뒤');
  });

  it.effect('runs the same steps without a LockManager', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      seed(storage, libraryOf(place(P1)));
      const result = yield* withStore({ storage }, (s) =>
        s.update((lib) => Effect.succeed(setPlaceMemo(lib, P1, '잠금 없음', ctx))),
      );
      expect(result.places[P1]!.memo.value).toBe('잠금 없음');
      expect((JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library).places[P1]!.memo.value).toBe(
        '잠금 없음',
      );
    }),
  );

  it.effect('invalid result writes nothing', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const raw = seed(storage, libraryOf(place(P1)));
      const duplicate = libraryOf(place(P1), place(P2, { source: place(P1).source }));
      const error = yield* withStore({ storage }, (s) =>
        Effect.flip(s.update(() => Effect.succeed(duplicate))),
      );
      expect(error).toBeInstanceOf(LibraryInvalid);
      expect((error as LibraryInvalid).issues.length).toBeGreaterThan(0);
      expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
    }),
  );

  it.effect('quota error maps to StorageQuotaExceeded and writes nothing', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const raw = seed(storage, libraryOf(place(P1)));
      storage.setItem = (key: string) => {
        if (key === LIBRARY_KEY) throw new DOMException('', 'QuotaExceededError');
      };
      const error = yield* withStore({ storage }, (s) =>
        Effect.flip(s.update((lib) => Effect.succeed(setPlaceMemo(lib, P1, '길게', ctx)))),
      );
      expect(error).toBeInstanceOf(StorageQuotaExceeded);
      expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
    }),
  );

  it.effect('quota: drops the disposable route cache and retries the library write once', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      seed(storage, libraryOf(place(P1)));
      storage.setItem(ROUTE_CACHE_KEY, '{"entries":{}}');
      // 경로 캐시가 있는 동안에는 보관함 쓰기가 용량 초과다.
      const setItem = storage.setItem.bind(storage);
      let libraryAttempts = 0;
      storage.setItem = (key: string, value: string) => {
        if (key === LIBRARY_KEY) {
          libraryAttempts += 1;
          if (storage.getItem(ROUTE_CACHE_KEY) !== null)
            throw new DOMException('', 'QuotaExceededError');
        }
        setItem(key, value);
      };
      const saved = yield* withStore({ storage }, (s) =>
        s.update((lib) => Effect.succeed(setPlaceMemo(lib, P1, '길게', ctx))),
      );
      expect(saved.places[P1]!.memo.value).toBe('길게');
      expect(libraryAttempts).toBe(2);
      expect(storage.getItem(ROUTE_CACHE_KEY)).toBeNull();
      const stored = JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library;
      expect(stored.places[P1]!.memo.value).toBe('길게');
    }),
  );

  it.effect.each(['getItem', 'removeItem'] as const)(
    'quota: 재시도 중 경로 캐시 %s가 던져도 StorageQuotaExceeded',
    (method) =>
      Effect.gen(function* () {
        const storage = createMemoryStorage();
        const raw = seed(storage, libraryOf(place(P1)));
        storage.setItem(ROUTE_CACHE_KEY, '{"entries":{}}');
        const original = storage[method].bind(storage) as (key: string) => string | null | void;
        storage[method] = ((key: string) => {
          if (key === ROUTE_CACHE_KEY) throw new Error('storage blocked');
          return original(key);
        }) as never;
        const setItem = storage.setItem.bind(storage);
        storage.setItem = (key: string, value: string) => {
          if (key === LIBRARY_KEY) throw new DOMException('', 'QuotaExceededError');
          setItem(key, value);
        };
        const error = yield* withStore({ storage }, (s) =>
          Effect.flip(s.update((lib) => Effect.succeed(setPlaceMemo(lib, P1, '길게', ctx)))),
        );
        expect(error).toBeInstanceOf(StorageQuotaExceeded);
        expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
      }),
  );

  it.effect('quota: still StorageQuotaExceeded when dropping the route cache is not enough', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const raw = seed(storage, libraryOf(place(P1)));
      storage.setItem(ROUTE_CACHE_KEY, '{"entries":{}}');
      let libraryAttempts = 0;
      storage.setItem = (key: string) => {
        if (key === LIBRARY_KEY) libraryAttempts += 1;
        throw new DOMException('', 'QuotaExceededError');
      };
      const error = yield* withStore({ storage }, (s) =>
        Effect.flip(s.update((lib) => Effect.succeed(setPlaceMemo(lib, P1, '길게', ctx)))),
      );
      expect(error).toBeInstanceOf(StorageQuotaExceeded);
      expect(libraryAttempts).toBe(2);
      expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
    }),
  );

  it.effect('size limit rejects before writing', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const raw = seed(storage, libraryOf(place(P1)));
      const setItem = storage.setItem.bind(storage);
      let writes = 0;
      storage.setItem = (key: string, value: string) => {
        if (key === LIBRARY_KEY) writes++;
        setItem(key, value);
      };
      const error = yield* withStore({ storage, limits: { libraryChars: 1_000 } }, (s) =>
        Effect.flip(
          s.update((lib) => Effect.succeed(setPlaceMemo(lib, P1, 'x'.repeat(2_000), ctx))),
        ),
      );
      expect(error).toBeInstanceOf(StorageQuotaExceeded);
      expect((error as StorageQuotaExceeded).bytes).toBeGreaterThan(1_000);
      expect(writes).toBe(0);
      expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
    }),
  );

  it.effect('default size limit is LIBRARY_LIMITS.libraryChars', () =>
    Effect.gen(function* () {
      expect(LIBRARY_LIMITS.libraryChars).toBe(4_000_000);
      const storage = createMemoryStorage();
      const memo = 'x'.repeat(LIBRARY_LIMITS.memoChars);
      // 메모 한도(10,000자)를 꽉 채운 장소 400곳은 4,000,000자를 넘는다.
      const places = Array.from({ length: 400 }, (_, i) =>
        place(`pl${String(i).padStart(8, '0')}`, { memo: f(memo) }),
      );
      const error = yield* withStore({ storage }, (s) =>
        Effect.flip(s.update(() => Effect.succeed(libraryOf(...places)))),
      );
      expect(error).toBeInstanceOf(StorageQuotaExceeded);
      expect(storage.getItem(LIBRARY_KEY)).toBeNull();
    }),
  );

  it.effect('update on a corrupt document writes nothing and reports no backup', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(LIBRARY_KEY, '{bad');
      const writes = spyWrites(storage);
      let ran = false;
      const error = yield* withStore({ storage }, (s) =>
        Effect.flip(
          s.update((lib) => {
            ran = true;
            return Effect.succeed(lib);
          }),
        ),
      );
      expect(error).toBeInstanceOf(LibraryCorrupt);
      expect((error as LibraryCorrupt).backupKey).toBeNull();
      expect(ran).toBe(false);
      expect(writes).toEqual([]);
      expect(corruptKeys(storage)).toEqual([]);
      expect(storage.getItem(LIBRARY_KEY)).toBe('{bad');
    }),
  );

  it.effect('update on a corrupt document reports the existing backup key', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(LIBRARY_KEY, '{bad');
      const writes = spyWrites(storage);
      const error = yield* withStore({ storage }, (s) =>
        Effect.gen(function* () {
          const loaded = yield* Effect.flip(s.load);
          writes.length = 0;
          const failed = yield* Effect.flip(s.update(Effect.succeed));
          expect((failed as LibraryCorrupt).backupKey).toBe(loaded.backupKey);
          return failed;
        }),
      );
      expect(error).toBeInstanceOf(LibraryCorrupt);
      expect(writes).toEqual([]);
    }),
  );

  vitestIt('reads the latest document after the lock is acquired', async () => {
    const storage = createMemoryStorage();
    const held = createHeldLocks();
    seed(storage, libraryOf(place(P1)));
    held.hold();
    const pending = Effect.runPromise(
      withStore({ storage, locks: held.locks }, (s) => s.update((lib) => Effect.succeed(lib))),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    // 다른 탭이 잠금을 쥔 채로 문서를 바꾼다.
    const changed = libraryOf(place(P1), place(P2));
    seed(storage, changed);
    held.release();
    expect(await pending).toEqual(changed);
  });

  it.effect("keeps f's typed error and writes nothing", () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const raw = seed(storage, libraryOf(place(P1)));
      const error = yield* withStore({ storage, locks: createHeldLocks().locks }, (s) =>
        Effect.flip(s.update(() => Effect.fail(new LabelNameTaken({ name: '맛집' })))),
      );
      expect(error).toBeInstanceOf(LabelNameTaken);
      expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
    }),
  );

  it.effect('returns the validated document it stored', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const result = yield* withStore({ storage }, (s) =>
        s.update(() => Effect.succeed(libraryOf(place(P1)))),
      );
      expect(storage.getItem(LIBRARY_KEY)).toBe(JSON.stringify(result));
    }),
  );
});

describe('LibraryStore.changes', () => {
  it.effect('changes is empty in memory mode even with an event source', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem = () => {
        throw new DOMException('denied', 'SecurityError');
      };
      const events = new EventTarget();
      const emitted = yield* withStore({ storage, events }, (s) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(Stream.runCollect(s.changes));
          events.dispatchEvent(
            new StorageEvent('storage', {
              key: LIBRARY_KEY,
              newValue: JSON.stringify(libraryOf()),
            }),
          );
          return yield* Fiber.join(fiber);
        }),
      );
      expect(emitted).toEqual([]);
    }),
  );

  it.effect('changes emits on storage event for LIBRARY_KEY only', () =>
    Effect.gen(function* () {
      const events = new EventTarget();
      const next = libraryOf(place(P1));
      const emitted = yield* withStore({ storage: createMemoryStorage(), events }, (s) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(Stream.runCollect(Stream.take(s.changes, 2)));
          // 스트림이 구독(리스너 등록)할 시간을 준다.
          yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 10)));
          const fire = (key: string | null, newValue: string | null) =>
            events.dispatchEvent(new StorageEvent('storage', { key, newValue }));
          fire('tripmap:prefs', JSON.stringify(libraryOf(place(P2))));
          fire(null, null);
          fire(LIBRARY_KEY, '{bad');
          fire(LIBRARY_KEY, JSON.stringify({ schemaVersion: 1 }));
          fire(LIBRARY_KEY, JSON.stringify(next));
          fire(LIBRARY_KEY, null);
          return yield* Fiber.join(fiber);
        }),
      );
      expect(emitted).toEqual([next, emptyLibrary()]);
    }),
  );

  it.effect('changes is empty without an event source', () =>
    Effect.gen(function* () {
      const emitted = yield* withStore({ storage: createMemoryStorage() }, (s) =>
        Stream.runCollect(s.changes),
      );
      expect(emitted).toEqual([]);
    }),
  );
});

const P3 = 'place00003';
const P9 = 'place00009';

/** `fails(key)`가 참인 키에 쓰면 용량 초과로 던지는 저장소 흉내(나머지는 그대로 쓴다). */
function failWrites(storage: Storage, fails: (key: string) => boolean): void {
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key: string, value: string) => {
    if (fails(key)) throw new DOMException('', 'QuotaExceededError');
    setItem(key, value);
  };
}

/** 저장소의 모든 키와 값. */
const dump = (storage: Storage): Record<string, string | null> =>
  Object.fromEntries(
    Array.from({ length: storage.length }, (_, i) => storage.key(i)!).map((k) => [
      k,
      storage.getItem(k),
    ]),
  );

const storedEnvelope = (storage: Storage): unknown => JSON.parse(storage.getItem(PREVIOUS_KEY)!);

/** 바꾸기 전 원문: 장소 2곳, 이 버전이 모르는 필드 포함(사본은 원문 그대로여야 한다). */
function seedTwoWithFuture(storage: Storage): string {
  const json = JSON.parse(JSON.stringify(libraryOf(place(P1), place(P2)))) as {
    places: Record<string, Record<string, unknown>>;
  };
  json.places[P1]!.futureField = '새 버전 정보';
  const raw = JSON.stringify(json);
  storage.setItem(LIBRARY_KEY, raw);
  return raw;
}

const NEXT = libraryOf(place(P9));

describe('LibraryStore.snapshot', () => {
  it.effect('keeps the raw JSON value (unknown fields) next to the validated library', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const text = seedTwoWithFuture(storage);
      const snap = yield* withStore({ storage }, (s) => s.snapshot);
      expect(snap.text).toBe(storage.getItem(LIBRARY_KEY));
      expect(snap.text).toBe(text);
      expect(snap.raw).toEqual(JSON.parse(text));
      expect((snap.raw as Library).places[P1]).toHaveProperty('futureField', '새 버전 정보');
      expect(snap.library.places[P1]).not.toHaveProperty('futureField');
      expect(snap.library).toEqual(libraryOf(place(P1), place(P2)));
    }),
  );

  it.effect('missing key gives two empty documents and text null', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const snap = yield* withStore({ storage }, (s) => s.snapshot);
      expect(snap).toEqual({ raw: emptyLibrary(), text: null, library: emptyLibrary() });
      expect(storage.length).toBe(0);
    }),
  );

  it.effect('corrupt document fails with LibraryCorrupt and writes nothing', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(LIBRARY_KEY, '{bad');
      const before = dump(storage);
      const error = yield* withStore({ storage }, (s) => Effect.flip(s.snapshot));
      expect(error).toBeInstanceOf(LibraryCorrupt);
      expect(error.backupKey).toBeNull();
      expect(dump(storage)).toEqual(before);
    }),
  );
});

describe('LibraryStore.replace', () => {
  it.effect('writes the new library and keeps the raw previous document in the envelope', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const storage = createMemoryStorage();
      const before = seedTwoWithFuture(storage);
      const result = yield* withStore({ storage }, (s) =>
        s.replace(NEXT, { requirePrevious: true }),
      );
      expect(result).toEqual({ library: NEXT, previousKept: true });
      expect(storage.getItem(LIBRARY_KEY)).toBe(JSON.stringify(NEXT));
      expect(storage.getItem(PREVIOUS_KEY)).toBe(
        JSON.stringify({
          format: BACKUP_FORMAT,
          v: BACKUP_VERSION,
          exportedAt: NOW,
          library: JSON.parse(before),
        }),
      );
      expect((storedEnvelope(storage) as { library: unknown }).library).toEqual(JSON.parse(before));
    }),
  );

  it.effect.each([
    ['key missing', null],
    ['empty document', JSON.stringify(emptyLibrary())],
  ] as const)('from an empty library (%s): no copy, and an old copy is removed', ([, raw]) =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      if (raw !== null) storage.setItem(LIBRARY_KEY, raw);
      storage.setItem(PREVIOUS_KEY, '{"old":true}');
      const result = yield* withStore({ storage }, (s) =>
        s.replace(NEXT, { requirePrevious: false }),
      );
      expect(result).toEqual({ library: NEXT, previousKept: false });
      expect(storage.getItem(LIBRARY_KEY)).toBe(JSON.stringify(NEXT));
      expect(storage.getItem(PREVIOUS_KEY)).toBeNull();
    }),
  );

  it.effect('a library with only tombstones is kept as the copy (it has entries)', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const raw = seed(storage, libraryOf(place(P1, { deletedAt: T0 })));
      const result = yield* withStore({ storage }, (s) =>
        s.replace(NEXT, { requirePrevious: false }),
      );
      expect(result.previousKept).toBe(true);
      expect((storedEnvelope(storage) as { library: unknown }).library).toEqual(JSON.parse(raw));
    }),
  );

  it.effect('from a corrupt document: backs up the raw, writes the new library, no copy', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(LIBRARY_KEY, '{bad');
      const result = yield* withStore({ storage }, (s) =>
        s.replace(NEXT, { requirePrevious: true }),
      );
      expect(result).toEqual({ library: NEXT, previousKept: false });
      expect(corruptKeys(storage).map((k) => storage.getItem(k))).toEqual(['{bad']);
      expect(storage.getItem(LIBRARY_KEY)).toBe(JSON.stringify(NEXT));
      expect(storage.getItem(PREVIOUS_KEY)).toBeNull();
    }),
  );

  it.effect('from a corrupt document: removes a copy left by an earlier restore', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      seed(storage, libraryOf(place(P1)));
      yield* withStore({ storage }, (s) => s.replace(NEXT, { requirePrevious: true }));
      expect(storage.getItem(PREVIOUS_KEY)).not.toBeNull();
      storage.setItem(LIBRARY_KEY, '{bad');
      const other = libraryOf(place(P3));
      yield* withStore({ storage }, (s) =>
        Effect.gen(function* () {
          const result = yield* s.replace(other, { requirePrevious: true });
          expect(result).toEqual({ library: other, previousKept: false });
          expect(storage.getItem(PREVIOUS_KEY)).toBeNull();
          expect(corruptKeys(storage).map((k) => storage.getItem(k))).toEqual(['{bad']);
          expect(storage.getItem(LIBRARY_KEY)).toBe(JSON.stringify(other));
          expect(yield* Effect.flip(s.restorePrevious)).toBeInstanceOf(NoPrevious);
        }),
      );
    }),
  );

  it.effect('from a corrupt document: reuses an existing backup of the same raw', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(LIBRARY_KEY, '{bad');
      yield* withStore({ storage }, (s) =>
        Effect.gen(function* () {
          const loaded = yield* Effect.flip(s.load);
          yield* s.replace(NEXT, { requirePrevious: true });
          expect(corruptKeys(storage)).toEqual([loaded.backupKey]);
        }),
      );
    }),
  );

  it.effect('an invalid next library fails with LibraryInvalid and changes no key', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      seed(storage, libraryOf(place(P1), place(P2)));
      storage.setItem(PREVIOUS_KEY, '{"old":true}');
      const before = dump(storage);
      const duplicate = libraryOf(place(P3), place(P9, { source: place(P3).source }));
      const error = yield* withStore({ storage }, (s) =>
        Effect.flip(s.replace(duplicate, { requirePrevious: true })),
      );
      expect(error).toBeInstanceOf(LibraryInvalid);
      expect(dump(storage)).toEqual(before);
    }),
  );

  it.effect('a next library over the size limit changes no key', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      seed(storage, libraryOf(place(P1)));
      const before = dump(storage);
      const big = libraryOf(place(P9, { memo: f('x'.repeat(2_000)) }));
      const error = yield* withStore({ storage, limits: { libraryChars: 1_000 } }, (s) =>
        Effect.flip(s.replace(big, { requirePrevious: false })),
      );
      expect(error).toBeInstanceOf(StorageQuotaExceeded);
      expect(dump(storage)).toEqual(before);
    }),
  );
});

describe('LibraryStore.replace: 저장 공간 부족', () => {
  it.effect('copy write over quota + requirePrevious → PreviousNotKept, library unchanged', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const raw = seed(storage, libraryOf(place(P1), place(P2)));
      failWrites(storage, (key) => key === PREVIOUS_KEY);
      const error = yield* withStore({ storage }, (s) =>
        Effect.flip(s.replace(NEXT, { requirePrevious: true })),
      );
      expect(error).toBeInstanceOf(PreviousNotKept);
      expect((error as PreviousNotKept).changedSinceSaved).toBe(false);
      expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
    }),
  );

  it.effect('copy write over quota without requirePrevious → replaced, stale copy removed', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      seed(storage, libraryOf(place(P1), place(P2)));
      storage.setItem(PREVIOUS_KEY, '{"old":true}');
      failWrites(storage, (key) => key === PREVIOUS_KEY);
      const result = yield* withStore({ storage }, (s) =>
        s.replace(NEXT, { requirePrevious: false }),
      );
      expect(result).toEqual({ library: NEXT, previousKept: false });
      expect(storage.getItem(LIBRARY_KEY)).toBe(JSON.stringify(NEXT));
      expect(storage.getItem(PREVIOUS_KEY)).toBeNull();
    }),
  );

  it.effect(
    'library write over quota (copy fits) + requirePrevious → PreviousNotKept, nothing kept',
    () =>
      Effect.gen(function* () {
        const storage = createMemoryStorage();
        const raw = seed(storage, libraryOf(place(P1), place(P2)));
        // 사본이 있는 동안에는 보관함 쓰기가 넘친다(사본을 지우면 들어간다).
        failWrites(storage, (key) => key === LIBRARY_KEY && storage.getItem(PREVIOUS_KEY) !== null);
        const error = yield* withStore({ storage }, (s) =>
          Effect.flip(s.replace(NEXT, { requirePrevious: true })),
        );
        expect(error).toBeInstanceOf(PreviousNotKept);
        expect((error as PreviousNotKept).changedSinceSaved).toBe(false);
        expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
        expect(storage.getItem(PREVIOUS_KEY)).toBeNull();
      }),
  );

  it.effect('library write over quota without requirePrevious → drops the copy and retries', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      seed(storage, libraryOf(place(P1), place(P2)));
      failWrites(storage, (key) => key === LIBRARY_KEY && storage.getItem(PREVIOUS_KEY) !== null);
      const result = yield* withStore({ storage }, (s) =>
        s.replace(NEXT, { requirePrevious: false }),
      );
      expect(result).toEqual({ library: NEXT, previousKept: false });
      expect(storage.getItem(LIBRARY_KEY)).toBe(JSON.stringify(NEXT));
      expect(storage.getItem(PREVIOUS_KEY)).toBeNull();
    }),
  );

  it.effect('library write always over quota → StorageQuotaExceeded, library unchanged', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const raw = seed(storage, libraryOf(place(P1), place(P2)));
      failWrites(storage, (key) => key === LIBRARY_KEY);
      const error = yield* withStore({ storage }, (s) =>
        Effect.flip(s.replace(NEXT, { requirePrevious: false })),
      );
      expect(error).toBeInstanceOf(StorageQuotaExceeded);
      expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
      expect(storage.getItem(PREVIOUS_KEY)).toBeNull();
    }),
  );

  it.effect('corrupt + backup write over quota + requirePrevious → PreviousNotKept', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(LIBRARY_KEY, '{bad');
      failWrites(storage, (key) => key.startsWith('tripmap:library:v2:corrupt-'));
      const error = yield* withStore({ storage }, (s) =>
        Effect.flip(s.replace(NEXT, { requirePrevious: true })),
      );
      expect(error).toBeInstanceOf(PreviousNotKept);
      expect((error as PreviousNotKept).changedSinceSaved).toBe(false);
      expect(storage.getItem(LIBRARY_KEY)).toBe('{bad');
      expect(corruptKeys(storage)).toEqual([]);
    }),
  );

  it.effect('corrupt + backup over quota, raw already downloaded → replaced without backup', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(LIBRARY_KEY, '{bad');
      failWrites(storage, (key) => key.startsWith('tripmap:library:v2:corrupt-'));
      const result = yield* withStore({ storage }, (s) =>
        s.replace(NEXT, { requirePrevious: false, savedText: '{bad' }),
      );
      expect(result).toEqual({ library: NEXT, previousKept: false });
      expect(storage.getItem(LIBRARY_KEY)).toBe(JSON.stringify(NEXT));
    }),
  );

  it.effect('corrupt raw changed since it was downloaded + backup over quota → changed', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(LIBRARY_KEY, '{bad-2');
      failWrites(storage, (key) => key.startsWith('tripmap:library:v2:corrupt-'));
      const error = yield* withStore({ storage }, (s) =>
        Effect.flip(s.replace(NEXT, { requirePrevious: false, savedText: '{bad' })),
      );
      expect(error).toBeInstanceOf(PreviousNotKept);
      expect((error as PreviousNotKept).changedSinceSaved).toBe(true);
      expect(storage.getItem(LIBRARY_KEY)).toBe('{bad-2');
    }),
  );
});

describe('LibraryStore.replace: 받은 뒤 바뀜', () => {
  /** 연 때 원문 `T0`(장소 1곳)과 다른 탭이 장소를 하나 더한 원문 `T1`. */
  const prepare = (storage: Storage) =>
    withStore({ storage }, (s) =>
      Effect.gen(function* () {
        seed(storage, libraryOf(place(P1)));
        const { text } = yield* s.snapshot;
        const t1 = JSON.stringify(libraryOf(place(P1), place(P2)));
        storage.setItem(LIBRARY_KEY, t1);
        return { t0: text, t1 };
      }),
    );

  it.effect('copy over quota and the raw changed since saved → PreviousNotKept(changed)', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const { t0, t1 } = yield* prepare(storage);
      expect(t0).not.toBe(t1);
      failWrites(storage, (key) => key === PREVIOUS_KEY);
      const error = yield* withStore({ storage }, (s) =>
        Effect.flip(s.replace(NEXT, { requirePrevious: false, savedText: t0 })),
      );
      expect(error).toBeInstanceOf(PreviousNotKept);
      expect((error as PreviousNotKept).changedSinceSaved).toBe(true);
      expect(storage.getItem(LIBRARY_KEY)).toBe(t1);
    }),
  );

  it.effect('the raw changed since saved and the copy fits → replaced, copy is the latest', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const { t0, t1 } = yield* prepare(storage);
      const result = yield* withStore({ storage }, (s) =>
        s.replace(NEXT, { requirePrevious: false, savedText: t0 }),
      );
      expect(result).toEqual({ library: NEXT, previousKept: true });
      expect((storedEnvelope(storage) as { library: unknown }).library).toEqual(JSON.parse(t1));
    }),
  );

  it.effect('saved raw equals the current raw + copy over quota → replaced without a copy', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const { t1 } = yield* prepare(storage);
      failWrites(storage, (key) => key === PREVIOUS_KEY);
      const result = yield* withStore({ storage }, (s) =>
        s.replace(NEXT, { requirePrevious: false, savedText: t1 }),
      );
      expect(result).toEqual({ library: NEXT, previousKept: false });
      expect(storage.getItem(LIBRARY_KEY)).toBe(JSON.stringify(NEXT));
    }),
  );

  it.effect('saved null (empty when opened) but a document now exists + copy over quota', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const raw = seed(storage, libraryOf(place(P1)));
      failWrites(storage, (key) => key === PREVIOUS_KEY);
      const error = yield* withStore({ storage }, (s) =>
        Effect.flip(s.replace(NEXT, { requirePrevious: false, savedText: null })),
      );
      expect(error).toBeInstanceOf(PreviousNotKept);
      expect((error as PreviousNotKept).changedSinceSaved).toBe(true);
      expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
    }),
  );

  vitestIt('reads the latest raw inside the lock and keeps it as the copy', async () => {
    const storage = createMemoryStorage();
    const held = createHeldLocks();
    seed(storage, libraryOf(place(P1)));
    held.hold();
    const pending = Effect.runPromise(
      withStore({ storage, locks: held.locks }, (s) => s.replace(NEXT, { requirePrevious: true })),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    // 다른 탭이 잠금을 쥔 채로 장소를 하나 더한다.
    const latest = seed(storage, libraryOf(place(P1), place(P2)));
    held.release();
    expect(await pending).toEqual({ library: NEXT, previousKept: true });
    expect(held.requested).toEqual([LIBRARY_LOCK]);
    expect((storedEnvelope(storage) as { library: unknown }).library).toEqual(JSON.parse(latest));
  });
});

describe('LibraryStore 되살리기 전 사본', () => {
  it.effect('previous gives the copy time and library; dropPrevious removes it', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const storage = createMemoryStorage();
      seed(storage, libraryOf(place(P1), place(P2)));
      yield* withStore({ storage }, (s) =>
        Effect.gen(function* () {
          expect(yield* s.previous).toBeNull();
          yield* s.replace(NEXT, { requirePrevious: true });
          expect(yield* s.previous).toEqual({
            savedAt: NOW,
            library: libraryOf(place(P1), place(P2)),
          });
          yield* s.dropPrevious;
          expect(yield* s.previous).toBeNull();
        }),
      );
      expect(storage.getItem(PREVIOUS_KEY)).toBeNull();
      expect(storage.getItem(LIBRARY_KEY)).toBe(JSON.stringify(NEXT));
    }),
  );

  vitestIt('dropPrevious waits for a held lock', async () => {
    const storage = createMemoryStorage();
    const held = createHeldLocks();
    storage.setItem(PREVIOUS_KEY, '{"copy":true}');
    held.hold();
    const pending = Effect.runPromise(
      withStore({ storage, locks: held.locks }, (s) => s.dropPrevious),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(storage.getItem(PREVIOUS_KEY)).toBe('{"copy":true}');
    held.release();
    await pending;
    expect(held.requested).toEqual([LIBRARY_LOCK]);
    expect(storage.getItem(PREVIOUS_KEY)).toBeNull();
  });

  it.effect('restorePrevious after replace brings back the library and removes the copy', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const original = libraryOf(place(P1), place(P2));
      seed(storage, original);
      const restored = yield* withStore({ storage }, (s) =>
        Effect.gen(function* () {
          yield* s.replace(NEXT, { requirePrevious: true });
          return yield* s.restorePrevious;
        }),
      );
      expect(restored).toEqual(original);
      expect(storage.getItem(LIBRARY_KEY)).toBe(JSON.stringify(original));
      expect(storage.getItem(PREVIOUS_KEY)).toBeNull();
    }),
  );

  it.effect('restorePrevious writes the raw library of the copy, unknown fields included', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const raw = seedTwoWithFuture(storage);
      yield* withStore({ storage }, (s) =>
        Effect.gen(function* () {
          yield* s.replace(NEXT, { requirePrevious: true });
          yield* s.restorePrevious;
        }),
      );
      expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
      expect(storage.getItem(LIBRARY_KEY)).toContain('futureField');
    }),
  );

  it.effect('restorePrevious without a copy fails with NoPrevious', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const raw = seed(storage, NEXT);
      const error = yield* withStore({ storage }, (s) => Effect.flip(s.restorePrevious));
      expect(error).toBeInstanceOf(NoPrevious);
      expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
    }),
  );

  it.effect.each([
    ['broken JSON', '{bad'],
    ['not an envelope', JSON.stringify({ format: 'tripmap-share' })],
    [
      'envelope with an invalid library',
      JSON.stringify({ format: BACKUP_FORMAT, v: 1, exportedAt: NOW, library: { x: 1 } }),
    ],
  ] as const)('an unreadable copy (%s): NoPrevious, previous null, copy left', ([, text]) =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const raw = seed(storage, NEXT);
      storage.setItem(PREVIOUS_KEY, text);
      yield* withStore({ storage }, (s) =>
        Effect.gen(function* () {
          expect(yield* Effect.flip(s.restorePrevious)).toBeInstanceOf(NoPrevious);
          expect(yield* s.previous).toBeNull();
        }),
      );
      expect(storage.getItem(PREVIOUS_KEY)).toBe(text);
      expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
    }),
  );

  it.effect('restorePrevious over quota keeps both the library and the copy', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      seed(storage, libraryOf(place(P1)));
      yield* withStore({ storage }, (s) => s.replace(NEXT, { requirePrevious: true }));
      const copy = storage.getItem(PREVIOUS_KEY);
      failWrites(storage, (key) => key === LIBRARY_KEY);
      const error = yield* withStore({ storage }, (s) => Effect.flip(s.restorePrevious));
      expect(error).toBeInstanceOf(StorageQuotaExceeded);
      expect(storage.getItem(PREVIOUS_KEY)).toBe(copy);
      expect(storage.getItem(LIBRARY_KEY)).toBe(JSON.stringify(NEXT));
    }),
  );

  it.effect('restorePrevious over a corrupt document backs up the raw first', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const original = libraryOf(place(P1));
      seed(storage, original);
      yield* withStore({ storage }, (s) => s.replace(NEXT, { requirePrevious: true }));
      storage.setItem(LIBRARY_KEY, '{bad');
      const restored = yield* withStore({ storage }, (s) => s.restorePrevious);
      expect(restored).toEqual(original);
      expect(corruptKeys(storage).map((k) => storage.getItem(k))).toEqual(['{bad']);
    }),
  );
});

describe('LibraryStore.update: 사본과 용량', () => {
  it.effect('over quota: drops the route cache first, then the copy, then saves', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      seed(storage, libraryOf(place(P1)));
      storage.setItem(ROUTE_CACHE_KEY, '{"entries":{}}');
      storage.setItem(PREVIOUS_KEY, '{"copy":true}');
      const removed: string[] = [];
      const removeItem = storage.removeItem.bind(storage);
      storage.removeItem = (key: string) => {
        if (key !== 'tripmap:probe') removed.push(key);
        removeItem(key);
      };
      // 경로 캐시나 사본이 하나라도 있으면 보관함 쓰기가 넘친다.
      failWrites(
        storage,
        (key) =>
          key === LIBRARY_KEY &&
          (storage.getItem(ROUTE_CACHE_KEY) !== null || storage.getItem(PREVIOUS_KEY) !== null),
      );
      const saved = yield* withStore({ storage }, (s) =>
        s.update((lib) => Effect.succeed(setPlaceMemo(lib, P1, '길게', ctx))),
      );
      expect(saved.places[P1]!.memo.value).toBe('길게');
      expect(removed).toEqual([ROUTE_CACHE_KEY, PREVIOUS_KEY]);
      expect(storage.getItem(LIBRARY_KEY)).toBe(JSON.stringify(saved));
    }),
  );

  it.effect('over quota: keeps the copy when dropping the route cache is enough', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      seed(storage, libraryOf(place(P1)));
      storage.setItem(ROUTE_CACHE_KEY, '{"entries":{}}');
      storage.setItem(PREVIOUS_KEY, '{"copy":true}');
      failWrites(
        storage,
        (key) => key === LIBRARY_KEY && storage.getItem(ROUTE_CACHE_KEY) !== null,
      );
      yield* withStore({ storage }, (s) =>
        s.update((lib) => Effect.succeed(setPlaceMemo(lib, P1, '길게', ctx))),
      );
      expect(storage.getItem(ROUTE_CACHE_KEY)).toBeNull();
      expect(storage.getItem(PREVIOUS_KEY)).toBe('{"copy":true}');
    }),
  );
});

describe('constants and errors', () => {
  vitestIt('corruptKey', () => {
    expect(corruptKey('2026-10-08T00:00:00.000Z')).toBe(
      'tripmap:library:v2:corrupt-2026-10-08T00:00:00.000Z',
    );
  });

  vitestIt('userMessage strings', () => {
    expect(new StorageQuotaExceeded({ bytes: 1 }).userMessage).toBe(
      '저장 공간이 부족해 저장하지 못했어요',
    );
    expect(new LibraryInvalid({ issues: [] }).userMessage).toBe(
      '저장하지 못했어요(데이터 검증 실패)',
    );
    expect(new LabelNameTaken({ name: 'a' }).userMessage).toBe('같은 이름의 라벨이 있어요');
    expect(new LegacyImportStale().userMessage).toBe('보관함이 바뀌어 미리보기를 다시 계산했어요');
    expect(new LegacyImportInvalid({ message: '파일이 이상해요' }).userMessage).toBe(
      '파일이 이상해요',
    );
    expect(new LibraryCorrupt({ backupKey: null, issues: [] })._tag).toBe('LibraryCorrupt');
    expect(new StorageUnavailable().userMessage.length).toBeGreaterThan(0);
  });

  vitestIt('PREVIOUS_KEY is not a corrupt-backup key', () => {
    expect(PREVIOUS_KEY).toBe('tripmap:library:v2:before-restore');
    expect(PREVIOUS_KEY.startsWith('tripmap:library:v2:corrupt-')).toBe(false);
  });

  vitestIt('PreviousNotKept and NoPrevious messages', () => {
    expect(new PreviousNotKept({ changedSinceSaved: true }).userMessage).toBe(
      "그사이 보관함이 바뀌었어요. '지금 보관함 먼저 받기'로 다시 받은 뒤 바꿔 주세요",
    );
    expect(new PreviousNotKept({ changedSinceSaved: false }).userMessage).toBe(
      "저장 공간이 부족해 지금 보관함을 기기에 남겨 둘 수 없어요. 먼저 '지금 보관함 먼저 받기'로 파일을 받은 뒤 바꿔 주세요",
    );
    expect(new NoPrevious().userMessage).toBe('되돌리지 못했어요');
  });
});
