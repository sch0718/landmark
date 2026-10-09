import { describe, expect, it as vitestIt } from 'vitest';
import { it } from '@effect/vitest';
import { Effect, Fiber, Stream } from 'effect';
import { setPlaceMemo, type OpCtx } from 'src/domain/library/ops';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { emptyLibrary, LIBRARY_LIMITS, type Library, type Place } from 'src/schema/library';
import {
  LabelNameTaken,
  LegacyImportInvalid,
  LegacyImportStale,
  LibraryCorrupt,
  LibraryInvalid,
  StorageQuotaExceeded,
  StorageUnavailable,
} from 'src/services/errors';
import {
  corruptKey,
  LIBRARY_KEY,
  LIBRARY_LOCK,
  LibraryStore,
  type LibraryStoreOptions,
} from 'src/services/library-store';
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
});
