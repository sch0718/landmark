import { describe, expect, it } from 'vitest';
import {
  checkShareTrip,
  dayEndId,
  dayPoints,
  SHARE_TRIP_LIMITS,
} from 'src/domain/share/check-share-trip';
import type { ShareDocV2, ShareLeg, ShareTrip } from 'src/schema/share';
import { IDS, leg, makeShareV2Doc as makeDoc } from '../../helpers/share-v2-doc';

function mutate(fn: (trip: ShareTrip, doc: ShareDocV2) => void): string[] {
  const doc = makeDoc();
  fn(doc.trips[0]!, doc);
  return checkShareTrip(doc);
}

describe('checkShareTrip', () => {
  it('정상 문서는 []', () => {
    expect(checkShareTrip(makeDoc())).toEqual([]);
  });

  it('기간과 days 개수가 다르면 거절', () => {
    expect(mutate((t) => (t.endDate = '2026-10-26')).length).toBeGreaterThan(0);
    expect(mutate((t) => t.days.pop()).length).toBeGreaterThan(0);
  });

  it('31일은 거절', () => {
    const problems = mutate((t) => {
      t.endDate = '2026-11-23';
      t.days = Array.from({ length: 31 }, () => ({
        startTime: '09:00',
        lodgingId: null,
        stops: [],
        legs: [],
      }));
    });
    expect(problems.some((p) => p.includes(String(SHARE_TRIP_LIMITS.maxDays)))).toBe(true);
  });

  it('시작일이 종료일보다 늦으면 거절', () => {
    expect(mutate((t) => (t.endDate = '2026-10-23')).length).toBeGreaterThan(0);
  });

  it('places에 없는 id를 거절', () => {
    expect(mutate((t) => (t.days[0]!.stops[0]!.placeId = 'nothere001')).length).toBeGreaterThan(0);
    expect(mutate((t) => (t.originId = 'nothere001')).length).toBeGreaterThan(0);
    expect(mutate((t) => (t.days[0]!.lodgingId = 'nothere001')).length).toBeGreaterThan(0);
    expect(mutate((t) => t.candidateIds.push('nothere001')).length).toBeGreaterThan(0);
  });

  it('같은 장소가 Stop과 후보에 둘 다 있으면 거절', () => {
    expect(mutate((t) => t.candidateIds.push(IDS.a)).length).toBeGreaterThan(0);
  });

  it('여행이 쓰지 않는 장소를 거절', () => {
    const problems = mutate((_, doc) =>
      doc.places.push({
        id: 'unused0001',
        name: '안 쓰는 곳',
        address: '',
        lng: 128.9,
        lat: 37.7,
        labelIds: [],
      }),
    );
    expect(problems).toHaveLength(1);
  });

  it('legs 개수가 어긋나면 거절', () => {
    expect(mutate((t) => t.days[0]!.legs.pop())).toHaveLength(1);
    expect(mutate((t) => t.days[1]!.legs.push(leg(IDS.c, IDS.c)))).toHaveLength(1);
  });

  it('Day 2의 출발점은 Day 1 숙소', () => {
    expect(mutate((t) => (t.days[1]!.legs[0] = leg(IDS.home, IDS.c)))).toHaveLength(1);
  });

  it('from/to 순서가 틀리면 거절', () => {
    expect(mutate((t) => (t.days[0]!.legs[0] = leg(IDS.a, IDS.home)))).toHaveLength(1);
  });

  it('routed인데 queriedAt이 null이면 거절', () => {
    expect(mutate((t) => (t.days[0]!.legs[0]!.queriedAt = null))).toHaveLength(1);
  });

  it('routed가 아닌데 queriedAt이 있으면 거절', () => {
    expect(mutate((t) => (t.days[0]!.legs[0]!.status = 'no-route'))).toHaveLength(2);
  });

  it('estimated인데 path에 점이 있으면 거절', () => {
    expect(
      mutate((t) => {
        const l = t.days[0]!.legs[0]!;
        l.status = 'estimated';
        l.queriedAt = null;
      }),
    ).toHaveLength(1);
    expect(
      mutate((t) => {
        const l = t.days[0]!.legs[0]!;
        l.status = 'estimated';
        l.queriedAt = null;
        l.path = [];
      }),
    ).toEqual([]);
  });

  it('한 구간 500점은 통과, 501점은 거절', () => {
    const pts = (n: number): [number, number][] => Array.from({ length: n }, () => [128.9, 37.7]);
    expect(mutate((t) => (t.days[0]!.legs[0]!.path = pts(500)))).toEqual([]);
    expect(mutate((t) => (t.days[0]!.legs[0]!.path = pts(501)))).toHaveLength(1);
  });

  it('문서 전체 40,000점은 통과, 40,001점은 거절', () => {
    // 하루에 Stop 81곳(출발지 포함 82점, 숙소 없음) → 구간 81개. 구간당 한도 500을 지키며 총점만 바꾼다.
    const build = (total: number): ShareDocV2 => {
      const base = makeDoc();
      const ids = Array.from({ length: 82 }, (_, i) => `bulk${String(i).padStart(6, '0')}`);
      const proto = base.places[0]!;
      base.places = ids.map((id) => ({ ...proto, id }));
      const [origin, ...stopIds] = ids;
      const legs: ShareLeg[] = stopIds.map((to, i) => {
        const from = i === 0 ? origin! : stopIds[i - 1]!;
        const n = Math.max(0, Math.min(500, total - i * 500));
        return leg(from, to, { path: Array.from({ length: n }, () => [128.9, 37.7]) });
      });
      base.trips[0] = {
        title: '많은 구간',
        startDate: '2026-10-24',
        endDate: '2026-10-24',
        originId: origin!,
        candidateIds: [],
        legModes: {},
        days: [
          {
            startTime: '09:00',
            lodgingId: null,
            stops: stopIds.map((placeId) => ({ placeId, stayMin: 10, fixedTime: null })),
            legs,
          },
        ],
      };
      return base;
    };
    expect(checkShareTrip(build(40_000))).toEqual([]);
    expect(checkShareTrip(build(40_001))).toHaveLength(1);
  });

  it('장소 1,001곳이어도 checkShareTrip은 막지 않는다', () => {
    // 장소 수 상한은 read-share의 `too-many`가 맡는다.
    const doc = makeDoc();
    const proto = doc.places[0]!;
    const extra = Array.from({ length: 1001 - doc.places.length }, (_, i) => ({
      ...proto,
      id: `extra${String(i).padStart(5, '0')}`,
    }));
    doc.places.push(...extra);
    doc.trips[0]!.candidateIds.push(...extra.map((p) => p.id));
    expect(doc.places).toHaveLength(1001);
    expect(checkShareTrip(doc)).toEqual([]);
  });

  it('legModes 키 형식을 거절', () => {
    expect(mutate((t) => (t.legModes['abc'] = 'car'))).toHaveLength(1);
    expect(mutate((t) => (t.legModes[`${IDS.a}>nothere001`] = 'car'))).toHaveLength(1);
    expect(mutate((t) => (t.legModes[`${IDS.a}>${IDS.b}>${IDS.c}`] = 'car'))).toHaveLength(1);
  });
});

describe('dayPoints', () => {
  const trip = (): ShareTrip => makeDoc().trips[0]!;

  it('출발지 있음 · 숙소 있음', () => {
    expect(dayPoints(trip(), 0)).toEqual([IDS.home, IDS.a, IDS.b, IDS.hotel]);
  });

  it('Day 2는 전날 숙소에서 출발, 숙소 없음', () => {
    expect(dayPoints(trip(), 1)).toEqual([IDS.hotel, IDS.c]);
  });

  it('출발지 없음 · 숙소 없음', () => {
    const t = trip();
    t.originId = null;
    t.days[0]!.lodgingId = null;
    expect(dayPoints(t, 0)).toEqual([IDS.a, IDS.b]);
  });

  it('출발지 있음 · 숙소 있음 · Stop 0', () => {
    const t = trip();
    t.days[0]!.stops = [];
    expect(dayPoints(t, 0)).toEqual([IDS.home, IDS.hotel]);
  });

  it('출발지 있음 · 숙소 없음 · Stop 2', () => {
    const t = trip();
    t.days[0]!.lodgingId = null;
    expect(dayPoints(t, 0)).toEqual([IDS.home, IDS.a, IDS.b]);
  });

  it('출발지 없음 · 숙소 있음 · Stop 0은 점이 하나뿐', () => {
    const t = trip();
    t.originId = null;
    t.days[0]!.stops = [];
    expect(dayPoints(t, 0)).toEqual([IDS.hotel]);
  });
});

describe('dayEndId', () => {
  it('그날 숙소 id. null·빈 문자열·없는 날은 null이고, dayPoints의 끝과 같다', () => {
    const trip = makeDoc().trips[0]!;
    expect(dayEndId(trip, 0)).toBe(IDS.hotel);
    expect(dayPoints(trip, 0).at(-1)).toBe(IDS.hotel);
    expect(dayEndId(trip, 1)).toBeNull();
    expect(dayEndId(trip, 5)).toBeNull();
    trip.days[0]!.lodgingId = '';
    expect(dayEndId(trip, 0)).toBeNull();
    expect(dayPoints(trip, 0)).toEqual([IDS.home, IDS.a, IDS.b]);
  });
});
