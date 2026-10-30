// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  assignServerPlaceIds,
  mapServerPlaces,
  renameStopIds,
  sameSource,
  serverIdOf,
  stopIdClashes,
} from 'src/domain/trip-collab/places';
import { buildLiveLibrary } from '../../../fixtures/builders';
import { buildLiveDoc } from '../../../fixtures/live-trip';
import { mkPlan } from './builders';
import { projectLocalTrip } from 'src/domain/trip-collab/plan';
const ctx = {
  now: '2026-11-01T00:00:00.000Z',
  newId: (kind: string) => (kind === 'stop' ? 'newstop0' : 'newplace00'),
};
describe('공동 여행 장소 대응', () => {
  it('같은 id와 네이버 출처는 항등으로 잇고 모두 대응하면 보관함 참조를 유지한다', () => {
    const lib = buildLiveLibrary(),
      doc = buildLiveDoc();
    const r = mapServerPlaces(lib, doc, {}, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.placeMap).toEqual({ place00001: 'place00001', place00002: 'place00002' });
    expect(r.lib).toBe(lib);
    expect(mapServerPlaces(lib, doc, r.placeMap, ctx)).toMatchObject({ ok: true, lib });
  });
  it('같은 id라도 출처가 다르면 새로 담는다', () => {
    const lib = buildLiveLibrary(),
      doc = buildLiveDoc();
    doc.share.places[0]!.naverSid = '999';
    const r = mapServerPlaces(lib, doc, {}, ctx);
    expect(r.ok && r.placeMap.place00001).toBe('newplace00');
  });
  it('다른 id의 같은 출처는 찾아 잇고 지운 항등 장소는 되살린다', () => {
    const original = buildLiveLibrary();
    const lib = {
      ...original,
      places: {
        place00001: { ...original.places.place00001!, deletedAt: ctx.now },
        other00002: { ...original.places.place00002!, id: 'other00002' },
      },
    };
    const r = mapServerPlaces(lib, buildLiveDoc(), {}, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.placeMap).toEqual({ place00001: 'place00001', place00002: 'other00002' });
    expect(Object.keys(r.lib.places)).toHaveLength(2);
    expect(r.lib.places.place00001!.deletedAt).toBeNull();
    expect(lib.places.place00001.deletedAt).toBe(ctx.now);
  });
  it('핀은 좌표가 같을 때만 같은 출처다', () => {
    const lib = buildLiveLibrary(),
      doc = buildLiveDoc(),
      p = doc.share.places[0]!;
    const { naverSid: _unused, ...shared } = p;
    void _unused;
    expect(sameSource({ ...lib.places.place00001!, source: { kind: 'pin' } }, shared)).toBe(true);
    expect(
      sameSource({ ...lib.places.place00001!, source: { kind: 'pin' }, lng: p.lng + 0.1 }, shared),
    ).toBe(false);
  });
  it('새 장소는 로컬 id를 쓰고 공동본과 겹치면 새 id를 만든다', () => {
    const trip = buildLiveLibrary().trips.trip000001!;
    const input = { known00001: 'place00001' };
    const result = assignServerPlaceIds(trip, input, new Set(['place00002']), () => 'newplace00');
    expect(result).toEqual({ ...input, newplace00: 'place00002' });
    expect(input).toEqual({ known00001: 'place00001' });
    expect(assignServerPlaceIds(trip, {}, new Set(), () => '')).toEqual({
      place00001: 'place00001',
      place00002: 'place00002',
    });
    expect(serverIdOf(result)('place00001')).toBe('known00001');
    expect(() => serverIdOf(result)('없는장소')).toThrow('대응이 없는 장소');
  });
  it('기준에 없는 Stop id 충돌만 찾아 로컬 Stop id를 바꾼다', () => {
    const m = mkPlan({ days: [['a']] }),
      t = mkPlan({ days: [['b']] });
    t.days[0]!.stops[0]!.id = m.days[0]!.stops[0]!.id;
    expect(stopIdClashes(m, t, null)).toEqual([m.days[0]!.stops[0]!.id]);
    expect(stopIdClashes(m, t, m)).toEqual([]);
    const lib = buildLiveLibrary(),
      r = renameStopIds(lib, 'trip000001', ['stop0001', '없는id'], ctx);
    expect(r.ok && r.lib.trips.trip000001!.days[0]!.stops.value[0]!.id).toBe('newstop0');
    expect(lib.trips.trip000001!.days[0]!.stops.value[0]!.id).toBe('stop0001');
  });
});

it('일정에서 뺀 장소의 과거 이동 수단 키도 서버 id로 투영할 수 있다', () => {
  const lib = buildLiveLibrary(),
    trip = {
      ...lib.trips.trip000001!,
      legModes: { value: { 'place00001>orphan0000': 'walk' as const }, updatedAt: ctx.now },
    };
  const map = assignServerPlaceIds(trip, {}, new Set(), () => 'newplace00');
  expect(map.orphan0000).toBe('orphan0000');
  expect(projectLocalTrip(trip, serverIdOf(map), ['day00001', 'day00002']).legModes).toEqual({
    'place00001>orphan0000': 'walk',
  });
});
