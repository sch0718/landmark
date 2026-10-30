// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyCollabPlan, importCollabTrip } from 'src/domain/trip-collab/apply';
import { planFromDoc } from 'src/domain/trip-collab/plan';
import { LibrarySchema } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { buildLiveLibrary } from '../../../fixtures/builders';
import { buildLiveDoc } from '../../../fixtures/live-trip';
const ctx = { now: '2026-11-01T00:00:00.000Z', newId: () => 'newtrip000' };
const map = { place00001: 'place00001', place00002: 'place00002' };
describe('공동 계획 보관함 반영', () => {
  it('같으면 보관함 참조를 유지하고 출발 시각만 바뀌면 그 필드만 갱신한다', () => {
    const lib = buildLiveLibrary(),
      p = planFromDoc(buildLiveDoc());
    const unchanged = applyCollabPlan(lib, 'trip000001', p, map, ctx);
    expect(unchanged.ok && unchanged.lib).toBe(lib);
    p.days[0]!.startTime = '10:00';
    const r = applyCollabPlan(lib, 'trip000001', p, map, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const before = lib.trips.trip000001!,
      after = r.lib.trips.trip000001!;
    expect(after.days[0]!.startTime).toEqual({ value: '10:00', updatedAt: ctx.now });
    expect(after.days[0]!.stops).toBe(before.days[0]!.stops);
    expect(after.days[1]).toBe(before.days[1]);
    expect(after.title).toBe(before.title);
    expect(safeParse(LibrarySchema, r.lib).success).toBe(true);
  });
  it('늘어난 Day의 세 필드 모두 지금 시각이다', () => {
    const p = planFromDoc(buildLiveDoc());
    p.endDate = '2026-12-11';
    p.days.push({ id: 'day00003', startTime: '08:00', lodging: null, stops: [] });
    const r = applyCollabPlan(buildLiveLibrary(), 'trip000001', p, map, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.values(r.lib.trips.trip000001!.days[2]!).map((f) => f.updatedAt)).toEqual([
      ctx.now,
      ctx.now,
      ctx.now,
    ]);
  });
  it('대응이 없거나 여행이 없으면 NotFound, 잘못된 배치는 TripChanged다', () => {
    const p = planFromDoc(buildLiveDoc()),
      lib = buildLiveLibrary();
    expect(applyCollabPlan(lib, 'trip000001', p, {}, ctx)).toEqual({
      ok: false,
      error: { _tag: 'NotFound', id: 'place00001' },
    });
    expect(applyCollabPlan(lib, '없는여행', p, map, ctx)).toEqual({
      ok: false,
      error: { _tag: 'NotFound', id: '없는여행' },
    });
    p.candidates.push('place00001');
    expect(applyCollabPlan(lib, 'trip000001', p, map, ctx)).toEqual({
      ok: false,
      error: { _tag: 'TripChanged', id: 'trip000001' },
    });
  });
  it('새 여행으로 담을 때 Stop·Day id와 장소 대응표를 보존한다', () => {
    const doc = buildLiveDoc(),
      r = importCollabTrip(buildLiveLibrary(), doc, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tripId).toBe('newtrip000');
    expect(r.dayIds).toEqual(doc.ids.days);
    expect(r.placeMap).toEqual(map);
    expect(r.lib.trips[r.tripId]!.days.map((d) => d.stops.value.map((s) => s.id))).toEqual(
      doc.ids.stops,
    );
    expect(r.lib.trips[r.tripId]!.title.value).toBe('시험 여행');
    expect(safeParse(LibrarySchema, r.lib).success).toBe(true);
  });
});
