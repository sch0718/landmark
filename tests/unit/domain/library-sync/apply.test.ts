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
it('서버 묘비를 받으면 삭제로 인한 수정 유실을 기록한다', () => {
  const local = { ...lib, places: { [p.id]: { ...p, memo: f('내 값', later) } } };
  expect(
    applyRemote(local, base, [remote({ ...p, deletedAt: now })], opts).conflicts.some(
      (c) => c.deleted,
    ),
  ).toBe(true);
});
it('전체 재동기화에서 서버에 없는 미변경 live 항목을 묘비로 맞춘다', () => {
  const result = applyRemote(lib, base, [], { ...opts, fullResync: true });
  expect(result.lib.places[p.id]?.deletedAt).toBe(now);
  expect(result.base['place:place00001']).toEqual({
    rev: 0,
    hash: hashItem({ ...p, deletedAt: now }),
    deleted: true,
  });
  expect(result.conflicts).toEqual([]);
  expect(dirtyItems(result.lib, result.base, [])).toEqual([]);
});
it('전체 재동기화의 미변경 항목 삭제도 기존 충돌 기록 조건을 따른다', () => {
  const result = applyRemote(lib, base, [], {
    ...opts,
    fullResync: true,
    lastSyncAt: '2026-10-02T00:00:00.000Z',
  });
  expect(result.conflicts).toEqual([
    expect.objectContaining({ mine: p, theirs: { ...p, deletedAt: now }, deleted: true }),
  ]);
});
it('전체 재동기화에서 정리된 묘비를 로컬에서 되살렸으면 새 항목으로 올린다', () => {
  const tombstoneBase = {
    'place:place00001': { rev: 2, hash: hashItem({ ...p, deletedAt: later }), deleted: true },
  };
  const result = applyRemote(lib, tombstoneBase, [], { ...opts, fullResync: true });
  expect(result.lib).toBe(lib);
  expect(result.lib.places[p.id]).toEqual(p);
  expect(result.base).not.toHaveProperty('place:place00001');
  expect(result.conflicts).toEqual([]);
  expect(dirtyItems(result.lib, result.base, [])).toEqual([
    expect.objectContaining({ key: 'place:place00001', doc: p, baseRev: 0, baseDeleted: null }),
  ]);
});
it.each([t, later, now, null])(
  '전체 재동기화에서 서버에 없는 로컬 수정 항목을 묘비로 맞추고 지난 동기화 %s 이후 수정만 충돌로 남긴다',
  (lastSyncAt) => {
    const changed = { ...p, memo: f('내 값', later) };
    const local = { ...lib, places: { [p.id]: changed } };
    const tombstone = { ...changed, deletedAt: now };
    const result = applyRemote(local, base, [], { ...opts, fullResync: true, lastSyncAt });
    expect(result.lib.places[p.id]).toEqual(tombstone);
    expect(result.base['place:place00001']).toEqual({
      rev: 0,
      hash: hashItem(tombstone),
      deleted: true,
    });
    expect(result.conflicts).toEqual(
      lastSyncAt !== null && later > lastSyncAt
        ? [expect.objectContaining({ mine: changed, theirs: tombstone, deleted: true })]
        : [],
    );
    expect(dirtyItems(result.lib, result.base, [])).toEqual([]);
  },
);
it('전체 재동기화에서 로컬에도 없는 항목의 base를 지운다', () => {
  const result = applyRemote(emptyLibrary(), base, [], { ...opts, fullResync: true });
  expect(result.lib.places).toEqual({});
  expect(result.base).toEqual({});
  expect(dirtyItems(result.lib, result.base, [])).toEqual([]);
});
it('전체 재동기화에서 로컬 묘비는 그대로 두고 base를 묘비로 맞춘다', () => {
  const tombstone = { ...p, deletedAt: later };
  const local = { ...lib, places: { [p.id]: tombstone } };
  const result = applyRemote(local, base, [], { ...opts, fullResync: true });
  expect(result.lib).toBe(local);
  expect(result.base['place:place00001']).toEqual({
    rev: 0,
    hash: hashItem(tombstone),
    deleted: true,
  });
  expect(result.conflicts).toEqual([]);
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
it('건너뛴 해석 불가 항목은 다시 보류하지 않고 base만 갱신한다', () => {
  const result = applyRemote(lib, base, [remote({ future: '알 수 없는 문서' })], {
    ...opts,
    skip: new Set(['place:place00001']),
  });
  expect(result.held).toEqual([]);
  expect(result.lib).toBe(lib);
  expect(result.base['place:place00001']?.rev).toBe(2);
});

it('복원으로 사라진 항목은 같은 revision의 전체 받기로 돌아오고 다음에는 차분만 받는다', () => {
  const restored = emptyLibrary();
  expect(missingFromLocal(restored, base)).toBe(true);
  const result = applyRemote(restored, base, [remote(p, 1)], { ...opts, fullResync: true });
  expect(result.lib.places[p.id]).toEqual(p);
  expect(result.base).toEqual(base);
  expect(result.conflicts).toEqual([]);
  expect(result.held).toEqual([]);
  expect(missingFromLocal(result.lib, result.base)).toBe(false);
  expect(dirtyItems(result.lib, result.base, [])).toEqual([]);
});

it('건너뛴 키는 이후 로컬 수정도 올리기 대상에서 제외한다', () => {
  const key = 'place:place00001';
  const skipped = new Set([key]);
  const result = applyRemote(lib, base, [remote({ future: '해석 불가' })], {
    ...opts,
    skip: skipped,
  });
  const changed = { ...lib, places: { [p.id]: { ...p, memo: f('건너뛴 뒤 수정', now) } } };
  expect(dirtyItems(result.lib, result.base, [], skipped)).toEqual([]);
  expect(dirtyItems(changed, result.base, [], skipped)).toEqual([]);
  expect(dirtyItems(changed, result.base, [], new Set())).toHaveLength(1);
});
