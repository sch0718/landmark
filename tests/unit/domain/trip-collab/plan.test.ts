// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  checkPlan,
  planFromDoc,
  planKey,
  projectLocalTrip,
  samePlan,
} from 'src/domain/trip-collab/plan';
import { buildLiveTripDoc, ESTIMATE_ONLY } from 'src/domain/trip-live/build-live-doc';
import { buildLiveLibrary } from '../../../fixtures/builders';
import { mkPlan, pid } from './builders';
describe('공동 계획 투영', () => {
  it('문서의 Day와 Stop id를 짝짓고 빈 메모를 채운다', () => {
    const doc = buildLiveTripDoc(buildLiveLibrary(), 'trip000001', ESTIMATE_ONLY, {
      title: '시험 여행',
      options: { includeMemo: false, includeCandidates: true },
      dayIds: ['day00001', 'day00002'],
      createdAt: '2026-11-01T00:00:00.000Z',
    })!;
    const plan = planFromDoc(doc);
    expect(plan.days.map((d) => d.id)).toEqual(doc.ids.days);
    expect(plan.days[0]!.stops[0]).toEqual({
      id: 'stop0001',
      placeId: 'place00001',
      stayMin: 60,
      fixedTime: null,
      note: '',
    });
    expect(plan.title).toBe(doc.share.trips[0]!.title);
    expect(checkPlan(plan)).toEqual([]);
  });
  it('지운 장소의 Stop도 저장된 값 그대로 담고 장소와 구간 키를 옮긴다', () => {
    const original = buildLiveLibrary();
    const lib = {
      ...original,
      places: {
        ...original.places,
        place00001: { ...original.places.place00001!, deletedAt: '2026-11-01T00:00:00Z' },
      },
    };
    const trip = lib.trips.trip000001!;
    const f = <T>(value: T) => ({ value, updatedAt: trip.createdAt });
    const mine = {
      ...trip,
      origin: f('place00001'),
      candidates: f(['place00002']),
      legModes: f({ 'place00001>place00002': 'walk' as const }),
      days: [{ ...trip.days[0]!, lodging: f('place00002') }],
    };
    const plan = projectLocalTrip(mine, (id) => (id === 'place00001' ? pid('a') : pid('b')), [
      'day00001',
    ]);
    expect(plan.days[0]!.stops[0]!.placeId).toBe(pid('a'));
    expect(plan.origin).toBe(pid('a'));
    expect(plan.candidates).toEqual([pid('b')]);
    expect(plan.days[0]!.lodging).toBe(pid('b'));
    expect(plan.legModes).toEqual({ [`${pid('a')}>${pid('b')}`]: 'walk' });
  });
  it('Day id 길이가 다르면 던진다', () =>
    expect(() => projectLocalTrip(buildLiveLibrary().trips.trip000001!, (s) => s, [])).toThrow(
      'dayIds',
    ));
  it('지문은 객체 키 순서와 무관하고 배열 순서는 구분한다', () => {
    const a = mkPlan({ days: [['a', 'b']], legModes: { x: 'car', y: 'walk' } });
    const b = { ...a, legModes: { y: 'walk' as const, x: 'car' as const } };
    expect(planKey(a)).toBe(planKey(b));
    expect(samePlan(a, b)).toBe(true);
    expect(samePlan(a, mkPlan({ days: [['b', 'a']] }))).toBe(false);
  });
  it('장소·Stop·Day 중복과 패턴, 날 수, 구간 키를 검사한다', () => {
    const good = mkPlan({ days: [['a'], ['b']] });
    expect(checkPlan(good)).toEqual([]);
    for (const mutate of [
      (p: typeof good) => p.candidates.push(pid('a')),
      (p: typeof good) => {
        p.days[1]!.stops[0]!.id = p.days[0]!.stops[0]!.id;
      },
      (p: typeof good) => {
        p.days[1]!.id = p.days[0]!.id;
      },
      (p: typeof good) => {
        p.days[0]!.id = 'BAD';
      },
      (p: typeof good) => {
        p.days[0]!.stops[0]!.id = 'BAD';
      },
      (p: typeof good) => {
        p.endDate = '2026-11-03';
      },
      (p: typeof good) => {
        p.endDate = '2026-10-31';
      },
      (p: typeof good) => {
        p.endDate = '2026-12-31';
      },
      (p: typeof good) => {
        p.legModes.x = 'walk';
      },
    ]) {
      const p = structuredClone(good);
      mutate(p);
      expect(checkPlan(p).length).toBeGreaterThan(0);
    }
  });
});
