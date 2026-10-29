import { expect, it } from 'vitest';
import {
  applyRemote,
  applyPushResults,
  dirtyItems,
  missingFromLocal,
  type ApplyOptions,
} from 'src/domain/library-sync/apply';
import { hashItem } from 'src/domain/library-sync/items';
import { emptyLibrary, type Place } from 'src/schema/library';
const t = '2026-10-03T00:00:00.000Z';
const later = '2026-10-04T00:00:00.000Z';
const now = '2026-10-05T00:00:00.000Z';
const f = <T>(value: T, updatedAt = t) => ({ value, updatedAt });
const p: Place = {
  id: 'place00001',
  source: { kind: 'pin' },
  name: f('장소'),
  address: '',
  lng: 127,
  lat: 37,
  category: f(null),
  memo: f('처음'),
  labelIds: f([]),
  saved: f(true),
  createdAt: t,
  deletedAt: null,
};
const lib = { ...emptyLibrary(), places: { [p.id]: p } };
const base = { 'place:place00001': { rev: 1, hash: hashItem(p), deleted: false } };
const opts: ApplyOptions = {
  ctx: { now, newId: () => 'unused' },
  lastSyncAt: t,
  fullResync: false,
  conflictId: () => 'conflict',
};
const remote = (doc: unknown = p, rev = 2) => ({
  kind: 'place' as const,
  id: p.id,
  doc,
  rev,
  deleted: false,
});
it('메아리는 참조를 유지하고 새 항목과 묘비를 추가한다', () => {
  expect(applyRemote(lib, base, [remote(p, 1)], opts).lib).toBe(lib);
  expect(applyRemote(emptyLibrary(), {}, [remote()], opts).lib.places[p.id]).toEqual(p);
  expect(
    applyRemote(emptyLibrary(), {}, [remote({ ...p, deletedAt: now })], opts).lib.places[p.id]
      ?.deletedAt,
  ).toBe(now);
});
it('바꾸지 않은 항목을 교체하고 양쪽 수정의 base는 서버 해시다', () => {
  const server = { ...p, memo: f('서버', now) };
  expect(applyRemote(lib, base, [remote(server)], opts).lib.places[p.id]).toEqual(server);
  const local = { ...lib, places: { [p.id]: { ...p, memo: f('내 값', later) } } };
  const result = applyRemote(local, base, [remote(server)], opts);
  expect(result.conflicts).toHaveLength(1);
  expect(result.conflicts[0]?.mine).toBe('내 값');
  expect(result.base['place:place00001']?.hash).toBe(hashItem(server));
  expect(
    applyRemote(local, base, [remote(server)], { ...opts, lastSyncAt: null }).conflicts,
  ).toEqual([]);
  expect(
    applyRemote(local, base, [remote(server)], { ...opts, lastSyncAt: now }).conflicts,
  ).toEqual([]);
});
it('삭제와 오래된 서버 묘비 정리에서 수정 유실을 기록한다', () => {
  const local = { ...lib, places: { [p.id]: { ...p, memo: f('내 값', later) } } };
  expect(
    applyRemote(local, base, [remote({ ...p, deletedAt: now })], opts).conflicts.some(
      (c) => c.deleted,
    ),
  ).toBe(true);
  const result = applyRemote(local, base, [], { ...opts, fullResync: true });
  expect(result.lib.places[p.id]?.deletedAt).toBe(now);
  expect(result.base['place:place00001']?.rev).toBe(0);
  expect(dirtyItems(result.lib, result.base, [])).toEqual([]);
});
it('해석 실패와 보관함 검증 실패만 보류한다', () => {
  expect(applyRemote(lib, base, [remote({})], opts).held[0]?.reason).toBe('decode');
  const trip = {
    id: 'trip000001',
    title: f('여행'),
    startDate: f('2026-11-01'),
    endDate: f('2026-11-01'),
    origin: f('missing001'),
    candidates: f([]),
    days: [{ stops: f([]), lodging: f(null), startTime: f('09:00') }],
    legModes: f({}),
    createdAt: t,
    deletedAt: null,
  };
  const result = applyRemote(
    emptyLibrary(),
    {},
    [remote(), { kind: 'trip', id: trip.id, doc: trip, rev: 2, deleted: false }],
    opts,
  );
  expect(result.lib.places[p.id]).toEqual(p);
  expect(result.lib.trips).toEqual({});
  expect(result.held).toEqual([{ key: 'trip:trip000001', rev: 2, reason: 'library' }]);
});
it('dirty와 사라진 로컬 항목을 찾고 같은 해시 거절은 제외한다', () => {
  expect(dirtyItems(lib, {}, [])).toHaveLength(1);
  expect(dirtyItems(lib, base, [])).toEqual([]);
  expect(dirtyItems(lib, {}, [{ key: 'place:place00001', hash: hashItem(p) }])).toEqual([]);
  expect(missingFromLocal(emptyLibrary(), base)).toBe(true);
});
it('올리는 중 수정은 서버 확인 후에도 다음 큐에 남는다', () => {
  const sent = dirtyItems(lib, {}, []);
  const response = [{ kind: 'place' as const, id: p.id, rev: 3 }];
  expect(applyPushResults(lib, {}, sent, response, opts).base['place:place00001']?.rev).toBe(3);
  const changed = { ...lib, places: { [p.id]: { ...p, memo: f('추가 수정', now) } } };
  const result = applyPushResults(changed, {}, sent, response, opts);
  expect(result.lib.places[p.id]?.memo.value).toBe('추가 수정');
  expect(dirtyItems(result.lib, result.base, [])).toHaveLength(1);
});
