import { describe, expect, vi } from 'vitest';
import { it } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import type { LibraryQuery } from 'src/domain/library/query';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { safeParse } from 'src/schema/parse';
import { DEFAULT_PREFS, LibraryQuerySchema, PrefsSchema, type Prefs } from 'src/schema/prefs';
import { PREFS_KEY, PrefsStore } from 'src/services/prefs-store';

const run = <A>(
  storage: Storage | undefined,
  use: (s: PrefsStore['Service']) => Effect.Effect<A>,
) =>
  Effect.gen(function* () {
    return yield* use(yield* PrefsStore);
  }).pipe(Effect.provide(PrefsStore.layerWith({ storage })));

describe('PrefsStore', () => {
  it.effect('returns defaults when nothing is stored', () =>
    Effect.gen(function* () {
      const prefs = yield* run(createMemoryStorage(), (s) => s.get);
      expect(prefs).toEqual(DEFAULT_PREFS);
      expect(DEFAULT_PREFS).toMatchObject({
        theme: 'pastel',
        mode: 'system',
        libraryView: 'bento',
      });
      const query: LibraryQuery = prefs.query;
      expect(query.sort).toBe('recent');
    }),
  );

  it.effect('returns defaults on invalid json', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(PREFS_KEY, '{bad');
      expect(yield* run(storage, (s) => s.get)).toEqual(DEFAULT_PREFS);
      storage.setItem(PREFS_KEY, JSON.stringify({ theme: 'neon' }));
      expect(yield* run(storage, (s) => s.get)).toEqual(DEFAULT_PREFS);
    }),
  );

  it.effect('round-trips prefs', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const prefs: Prefs = {
        theme: 'night',
        mode: 'dark',
        libraryView: 'list',
        query: {
          labelIds: ['labelaaa'],
          mode: 'all',
          unlabeled: false,
          regions: ['강릉'],
          text: '카페',
          sort: 'name',
          visited: 'visited',
        },
      };
      const read = yield* run(storage, (s) => s.set(prefs).pipe(Effect.andThen(s.get)));
      expect(read).toEqual(prefs);
      expect(JSON.parse(storage.getItem(PREFS_KEY)!)).toEqual(prefs);
    }),
  );

  it.effect('ignores write failures with a console warning', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const setItem = storage.setItem.bind(storage);
      storage.setItem = (key: string, value: string) => {
        if (key === PREFS_KEY) throw new DOMException('', 'QuotaExceededError');
        setItem(key, value);
      };
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      yield* run(storage, (s) => s.set(DEFAULT_PREFS));
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    }),
  );

  it.effect('works on memory when storage is unavailable', () =>
    Effect.gen(function* () {
      const prefs = { ...DEFAULT_PREFS, theme: 'paper' as const };
      const read = yield* run(undefined, (s) => s.set(prefs).pipe(Effect.andThen(s.get)));
      expect(read.theme).toBe('paper');
    }),
  );

  const OLD_QUERY = {
    labelIds: ['labelaaa'],
    mode: 'all',
    unlabeled: false,
    regions: ['강릉'],
    text: '카페',
    sort: 'name',
  };

  it.effect('visited 키가 없는 옛 선호는 visited가 all이고 나머지 선호는 그대로다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(
        PREFS_KEY,
        JSON.stringify({ theme: 'night', mode: 'dark', libraryView: 'list', query: OLD_QUERY }),
      );
      const prefs = yield* run(storage, (s) => s.get);
      expect(prefs.query.visited).toBe('all');
      expect(prefs.theme).toBe('night');
      expect(prefs.mode).toBe('dark');
      expect(prefs.libraryView).toBe('list');
      expect(prefs.query).toEqual({ ...OLD_QUERY, visited: 'all' });
    }),
  );

  it.effect('visited가 모르는 값이면 기본값(선호 전체)으로 돌아간다', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(
        PREFS_KEY,
        JSON.stringify({
          theme: 'night',
          mode: 'dark',
          libraryView: 'list',
          query: { ...OLD_QUERY, visited: 'maybe' },
        }),
      );
      expect(yield* run(storage, (s) => s.get)).toEqual(DEFAULT_PREFS);
    }),
  );

  it.effect('sort에 visited를 넣어도 받지 않는다(판정 A: 리터럴을 넓히지 않았다)', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(
        PREFS_KEY,
        JSON.stringify({
          theme: 'night',
          mode: 'dark',
          libraryView: 'list',
          query: { ...OLD_QUERY, sort: 'visited', visited: 'all' },
        }),
      );
      expect(yield* run(storage, (s) => s.get)).toEqual(DEFAULT_PREFS);
    }),
  );

  it('옛 모양 스키마(visited 없음)로 새 선호를 읽어도 통과하고 visited 키만 빠진다', () => {
    // 옛 버전의 PrefsSchema: 모르는 키는 떼어 내고 통과해야 선호 전체를 버리지 않는다.
    const OldPrefsSchema = Schema.Struct({
      theme: PrefsSchema.fields.theme,
      mode: PrefsSchema.fields.mode,
      libraryView: PrefsSchema.fields.libraryView,
      query: Schema.Struct({
        labelIds: LibraryQuerySchema.fields.labelIds,
        mode: LibraryQuerySchema.fields.mode,
        unlabeled: LibraryQuerySchema.fields.unlabeled,
        regions: LibraryQuerySchema.fields.regions,
        text: LibraryQuerySchema.fields.text,
        sort: LibraryQuerySchema.fields.sort,
      }),
    });
    const stored = {
      theme: 'night',
      mode: 'dark',
      libraryView: 'list',
      query: { ...OLD_QUERY, visited: 'visited' },
    };
    const parsed = safeParse(OldPrefsSchema, stored);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.theme).toBe('night');
      expect(parsed.data.query).toEqual(OLD_QUERY);
      expect('visited' in parsed.data.query).toBe(false);
    }
  });
});
