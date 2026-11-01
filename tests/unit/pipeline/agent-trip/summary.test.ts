// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ShareLegTime } from 'src/domain/share/build-trip-share';
import type { Leg } from 'src/domain/trips/query';
import { buildLibrary } from '../../../../pipeline/agent-trip/build-library';
import type { TripPlan } from '../../../../pipeline/agent-trip/plan-schema';
import type { ResolvedPlace } from '../../../../pipeline/agent-trip/resolve-places';
import { summarize } from '../../../../pipeline/agent-trip/summary';

const fixture = JSON.parse(
  readFileSync(new URL('../../../fixtures/agent-trip/plan.json', import.meta.url), 'utf8'),
) as TripPlan;
const NOW = new Date('2026-11-01T05:12:00.000Z');
function setup(p: TripPlan) {
  const places: ResolvedPlace[] = p.places.map((place, index) => ({
    key: place.key,
    index,
    candidate: {
      source: { kind: 'pin' },
      name: place.name!,
      address: place.address ?? '',
      lng: place.lng!,
      lat: place.lat!,
      category: null,
    },
    memo: place.memo ?? '',
  }));
  return buildLibrary(p, places, NOW, []);
}
const time = (durationS: number, status: ShareLegTime['status'] = 'routed'): ShareLegTime => ({
  durationS,
  distanceM: 1000,
  tollFare: null,
  status,
  queriedAt: status === 'routed' ? NOW.toISOString() : null,
  path: [],
});

describe('앱 일정 계산을 쓰는 Day 요약', () => {
  it('09:00 출발·102분 이동·12:00 고정·60분 체류를 설계 예시대로 요약한다', () => {
    const p = structuredClone(fixture);
    const built = setup(p);
    const routeOf = (leg: Leg) =>
      time(leg.from.id === built.placeIds.get('gangnam') ? 102 * 60 : 56 * 60);
    const result = summarize(built, routeOf, p);
    expect(result[0]).toEqual({
      date: '2026-11-20',
      stops: [
        {
          key: 'tofu',
          name: '학사평 순두부마을',
          arrive: '10:42',
          depart: '13:00',
          fixedTime: '12:00',
          slackMin: 78,
        },
        {
          key: 'beach',
          name: '속초해수욕장',
          arrive: '13:56',
          depart: '15:26',
          fixedTime: null,
          slackMin: null,
        },
      ],
      travelMin: 214,
      estimatedLegs: 0,
    });
    expect(result[1]?.date).toBe('2026-11-21');
    expect(result[1]?.stops[0]?.key).toBe('market');
  });

  it('출발점 없는 첫 Stop은 시작 시각이고 null 체류는 앱처럼 0분이다', () => {
    const p = structuredClone(fixture);
    p.origin = null;
    p.days[0]!.stops[0] = { place: 'tofu', stayMin: null };
    const result = summarize(setup(p), () => time(60), p);
    expect(result[0]?.stops[0]).toEqual({
      key: 'tofu',
      name: '학사평 순두부마을',
      arrive: '09:00',
      depart: '09:00',
      fixedTime: null,
      slackMin: null,
    });
  });

  it('자정 넘김·늦음·초 합산 뒤 반올림·추정 상태 수를 앱 규칙대로 표시한다', () => {
    const p = structuredClone(fixture);
    p.days[0]!.startTime = '23:50';
    p.days[0]!.stops[0] = { place: 'tofu', stayMin: 0, fixedTime: '23:55' };
    p.days[0]!.stops[1] = { place: 'beach', stayMin: null };
    let n = 0;
    const result = summarize(
      setup(p),
      () =>
        [time(1200, 'estimated'), time(30, 'no-route'), time(0, 'same-point'), time(60), time(60)][
          n++
        ]!,
      p,
    );
    expect(result[0]?.stops[0]).toMatchObject({
      arrive: '다음 날 00:10',
      depart: '다음 날 00:10',
      slackMin: -15,
    });
    expect(result[0]?.travelMin).toBe(21);
    expect(result[0]?.estimatedLegs).toBe(2);
    expect(result[1]?.estimatedLegs).toBe(0);
  });

  it('빈 Day의 출발지→숙소 구간도 이동 합계에 넣는다', () => {
    const p = structuredClone(fixture);
    p.days[0]!.stops = [];
    p.legModes = {};
    expect(summarize(setup(p), () => time(90), p)[0]).toEqual({
      date: '2026-11-20',
      stops: [],
      travelMin: 2,
      estimatedLegs: 0,
    });
  });
});
