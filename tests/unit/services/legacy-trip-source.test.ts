import { describe, expect, vi } from 'vitest';
import { it } from '@effect/vitest';
import { Effect } from 'effect';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { LegacyImportInvalid } from 'src/services/errors';
import { LegacyTripSource } from 'src/services/legacy-trip-source';
import { makeEdit, makeTrip } from '../../fixtures/builders';

const trip = makeTrip({ days: {}, places: ['A', 'B'] });
const EDIT_KEY = `tripmap:edit:${trip.publicId}`;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function sourceWith(options: { storage?: Storage; fetch?: typeof fetch } = {}) {
  const fetchFn = options.fetch ?? vi.fn(async () => jsonResponse(trip));
  return {
    fetchFn,
    use: <A, E>(f: (s: LegacyTripSource['Service']) => Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        return yield* f(yield* LegacyTripSource);
      }).pipe(
        Effect.provide(
          LegacyTripSource.layerWith({ storage: options.storage, fetch: fetchFn as typeof fetch }),
        ),
      ),
  };
}

const fileOf = (text: string) => new File([text], 'trip.json', { type: 'application/json' });

describe('LegacyTripSource', () => {
  it.effect('reads a TripData file', () =>
    Effect.gen(function* () {
      const { use } = sourceWith({ storage: createMemoryStorage() });
      const result = yield* use((s) => s.fromFile(fileOf(JSON.stringify(trip))));
      expect(result.trip).toEqual(trip);
      expect(result.edit).toBeNull();
    }),
  );

  it.effect('rejects invalid json with LegacyImportInvalid', () =>
    Effect.gen(function* () {
      const { use } = sourceWith({ storage: createMemoryStorage() });
      const err = yield* use((s) => s.fromFile(fileOf('{not json'))).pipe(Effect.flip);
      expect(err).toBeInstanceOf(LegacyImportInvalid);

      const wrongShape = yield* use((s) => s.fromFile(fileOf('{"schemaVersion":1}'))).pipe(
        Effect.flip,
      );
      expect(wrongShape).toBeInstanceOf(LegacyImportInvalid);
      expect(wrongShape.message).not.toBe('');

      // 장소의 알 수 없는 키는 거부한다(TRIP_DATA_PARSE).
      const badPlace = structuredClone(trip) as unknown as { places: Record<string, object> };
      Object.assign(badPlace.places['n:1']!, { shareId: 'secret' });
      const rejected = yield* use((s) => s.fromFile(fileOf(JSON.stringify(badPlace)))).pipe(
        Effect.flip,
      );
      expect(rejected).toBeInstanceOf(LegacyImportInvalid);
    }),
  );

  it.effect('reads edit layer of same publicId when present', () =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      const edit = makeEdit({
        places: {
          'n:1': { memos: { 'a-local': { text: '내 메모', updatedAt: trip.dataVersion } } },
        },
      });
      storage.setItem(EDIT_KEY, JSON.stringify(edit));
      storage.setItem('tripmap:edit:otherrtrip01', '{"x":1}');
      const { use, fetchFn } = sourceWith({ storage });

      const fromFile = yield* use((s) => s.fromFile(fileOf(JSON.stringify(trip))));
      expect(fromFile.edit).toEqual(edit);

      const fromId = yield* use((s) => s.fromPublicId(trip.publicId));
      expect(fromId.trip).toEqual(trip);
      expect(fromId.edit).toEqual(edit);
      expect(fetchFn).toHaveBeenCalledWith(`/data/${trip.publicId}.json`);
    }),
  );

  const untouched = (raw: string) =>
    Effect.gen(function* () {
      const storage = createMemoryStorage();
      storage.setItem(EDIT_KEY, raw);
      const setItem = vi.spyOn(storage, 'setItem');
      const removeItem = vi.spyOn(storage, 'removeItem');
      const { use } = sourceWith({ storage });
      const result = yield* use((s) => s.fromFile(fileOf(JSON.stringify(trip))));
      expect(result.edit).toBeNull();
      expect(setItem).not.toHaveBeenCalled();
      expect(removeItem).not.toHaveBeenCalled();
      expect(storage.getItem(EDIT_KEY)).toBe(raw);
      expect(storage.length).toBe(1);
    });

  it.effect(
    'corrupt or future-version edit layer yields edit null and leaves storage untouched',
    () =>
      Effect.gen(function* () {
        yield* untouched('{corrupt json');
        yield* untouched(JSON.stringify({ ...makeEdit(), schemaVersion: 2 }));
        yield* untouched(JSON.stringify({ schemaVersion: 1, publicId: 'x' }));
      }),
  );

  it.effect('works without usable storage', () =>
    Effect.gen(function* () {
      const { use } = sourceWith({ storage: undefined });
      const result = yield* use((s) => s.fromFile(fileOf(JSON.stringify(trip))));
      expect(result.edit).toBeNull();
    }),
  );

  it.effect('fetch 404 -> LegacyImportInvalid', () =>
    Effect.gen(function* () {
      const { use } = sourceWith({
        storage: createMemoryStorage(),
        fetch: vi.fn(async () => new Response('', { status: 404 })),
      });
      const err = yield* use((s) => s.fromPublicId(trip.publicId)).pipe(Effect.flip);
      expect(err).toBeInstanceOf(LegacyImportInvalid);
      expect(err.message).toBe('여행 데이터를 찾지 못했어요');
    }),
  );

  it.effect('SPA fallback html (200) is treated as not found', () =>
    Effect.gen(function* () {
      const { use } = sourceWith({
        fetch: vi.fn(async () => new Response('<!doctype html><html></html>', { status: 200 })),
      });
      const err = yield* use((s) => s.fromPublicId(trip.publicId)).pipe(Effect.flip);
      expect(err.message).toBe('여행 데이터를 찾지 못했어요');
    }),
  );

  it.effect('network failure and invalid body are LegacyImportInvalid', () =>
    Effect.gen(function* () {
      const offline = sourceWith({
        fetch: vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        }),
      });
      const a = yield* offline.use((s) => s.fromPublicId(trip.publicId)).pipe(Effect.flip);
      expect(a).toBeInstanceOf(LegacyImportInvalid);

      const bad = sourceWith({ fetch: vi.fn(async () => jsonResponse({ schemaVersion: 1 })) });
      const b = yield* bad.use((s) => s.fromPublicId(trip.publicId)).pipe(Effect.flip);
      expect(b).toBeInstanceOf(LegacyImportInvalid);
    }),
  );

  it.effect('rejects a malformed public id without fetching', () =>
    Effect.gen(function* () {
      const { use, fetchFn } = sourceWith();
      const err = yield* use((s) => s.fromPublicId('../etc/passwd')).pipe(Effect.flip);
      expect(err).toBeInstanceOf(LegacyImportInvalid);
      expect(fetchFn).not.toHaveBeenCalled();
    }),
  );
});
