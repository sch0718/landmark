import { expect, it } from 'vitest';
import { repairLibrary } from 'src/domain/library-sync/repair';
import { stableStringify } from 'src/domain/library-sync/items';
import { emptyLibrary, LibrarySchema, type Label, type Place } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
const t = '2026-10-03T00:00:00.000Z';
const now = '2026-10-06T00:00:00.000Z';
const f = <T>(value: T, updatedAt = t) => ({ value, updatedAt });
const ctx = { now, newId: () => 'unused' };
const label = (id: string, name: string): Label => ({
  id,
  name: f(name),
  color: f('red'),
  icon: f('star'),
  order: f(0),
  createdAt: t,
  deletedAt: null,
});
const place = (id: string, ids: string[] = []): Place => ({
  id,
  source: { kind: 'naver', sid: '123' },
  name: f('장소'),
  address: '',
  lng: 127,
  lat: 37,
  category: f(null),
  memo: f(''),
  labelIds: f(ids),
  saved: f(true),
  createdAt: t,
  deletedAt: null,
});
it('고칠 것이 없으면 같은 참조다', () => {
  const lib = emptyLibrary();
  expect(repairLibrary(lib, ctx)).toBe(lib);
});
it('라벨 이름과 출처 중복을 순서와 무관하게 정리한다', () => {
  const a = place('place00001', ['label002']);
  const b = { ...place('place00002', ['label003']), memo: f('새 메모', now) };
  const lib = {
    ...emptyLibrary(),
    labels: {
      label001: label('label001', '맛집'),
      label002: label('label002', ' 맛집 '),
      label003: label('label003', '카페'),
    },
    places: { [b.id]: b, [a.id]: a },
    folders: {
      Share01: {
        shareId: 'Share01',
        name: f('폴더'),
        labelId: f('label002'),
        seenSids: f([]),
        checkedAt: t,
        createdAt: t,
        deletedAt: null,
      },
    },
  };
  const result = repairLibrary(lib, ctx);
  expect(result.labels.label002?.deletedAt).toBe(now);
  expect(result.places[a.id]?.memo.value).toBe('새 메모');
  expect(result.places[a.id]?.labelIds.value).toEqual(['label001', 'label003']);
  expect(result.places[b.id]?.deletedAt).toBe(now);
  expect(result.folders?.Share01?.labelId.value).toBe('label001');
  expect(safeParse(LibrarySchema, result).success).toBe(true);
  expect(stableStringify(repairLibrary({ ...lib, places: { [a.id]: a, [b.id]: b } }, ctx))).toBe(
    stableStringify(result),
  );
});
it('끊긴 라벨과 폴더를 정리한다', () => {
  const lib = {
    ...emptyLibrary(),
    places: { place00001: place('place00001', ['label001']) },
    folders: {
      Share01: {
        shareId: 'Share01',
        name: f('폴더'),
        labelId: f('label001'),
        seenSids: f([]),
        checkedAt: t,
        createdAt: t,
        deletedAt: null,
      },
    },
  };
  const result = repairLibrary(lib, ctx);
  expect(result.places.place00001?.labelIds.value).toEqual([]);
  expect(result.folders?.Share01?.deletedAt).toBe(now);
});
it('여행 origin은 옮기고 이미 함께 참조한 후보는 남긴다', () => {
  const a = place('place00001');
  const b = place('place00002');
  const trip = {
    id: 'trip000001',
    title: f('여행'),
    startDate: f('2026-11-01'),
    endDate: f('2026-11-01'),
    origin: f(b.id),
    candidates: f([a.id, b.id]),
    days: [{ stops: f([]), lodging: f(b.id), startTime: f('09:00') }],
    legModes: f({}),
    createdAt: t,
    deletedAt: null,
  };
  const result = repairLibrary(
    { ...emptyLibrary(), places: { [a.id]: a, [b.id]: b }, trips: { [trip.id]: trip } },
    ctx,
  );
  expect(result.trips[trip.id]?.origin.value).toBe(a.id);
  expect(result.trips[trip.id]?.days[0]?.lodging.value).toBe(a.id);
  expect(result.trips[trip.id]?.candidates.value).toEqual([a.id, b.id]);
  const single = repairLibrary(
    {
      ...emptyLibrary(),
      places: { [a.id]: a, [b.id]: b },
      trips: { [trip.id]: { ...trip, candidates: f([b.id]) } },
    },
    ctx,
  );
  expect(single.trips[trip.id]?.candidates.value).toEqual([a.id]);
});
