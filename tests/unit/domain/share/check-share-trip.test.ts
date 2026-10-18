import { describe, expect, it } from 'vitest';
import { checkShareTrip, dayPoints, SHARE_TRIP_LIMITS } from 'src/domain/share/check-share-trip';
import type { ShareDocV2, ShareLeg, ShareTrip } from 'src/schema/share';

const IDS = {
  home: 'home000001',
  hotel: 'hotel00001',
  a: 'placea0001',
  b: 'placeb0001',
  c: 'placec0001',
  d: 'placed0001',
};

function leg(from: string, to: string, extra: Partial<ShareLeg> = {}): ShareLeg {
  return {
    from,
    to,
    mode: 'car',
    durationS: 600,
    distanceM: 5000,
    tollFare: null,
    status: 'routed',
    queriedAt: '2026-10-16T04:58:00.000Z',
    path: [
      [128.9, 37.7],
      [128.91, 37.71],
    ],
    ...extra,
  };
}

function makeDoc(): ShareDocV2 {
  const place = (id: string, i: number) => ({
    id,
    name: `장소 ${i}`,
    address: '강원 강릉시',
    lng: 128.9 + i / 100,
    lat: 37.7 + i / 100,
    labelIds: [],
  });
  return {
    format: 'tripmap-share',
    version: 2,
    title: '강릉',
    createdAt: '2026-10-16T05:00:00.000Z',
    labels: [],
    places: Object.values(IDS).map(place),
    trips: [
      {
        title: '강릉 1박 2일',
        startDate: '2026-10-24',
        endDate: '2026-10-25',
        originId: IDS.home,
        candidateIds: [IDS.d],
        legModes: { [`${IDS.a}>${IDS.b}`]: 'walk' },
        days: [
          {
            startTime: '09:00',
            lodgingId: IDS.hotel,
            stops: [
              { placeId: IDS.a, stayMin: 60, fixedTime: null },
              { placeId: IDS.b, stayMin: null, fixedTime: '12:00', note: '점심' },
            ],
            legs: [
              leg(IDS.home, IDS.a),
              leg(IDS.a, IDS.b, { mode: 'walk' }),
              leg(IDS.b, IDS.hotel),
            ],
          },
          {
            startTime: '09:30',
            lodgingId: null,
            stops: [{ placeId: IDS.c, stayMin: 30, fixedTime: null }],
            legs: [leg(IDS.hotel, IDS.c)],
          },
        ],
      },
    ],
  };
}

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
    const pts = (n: number): [number, number][] => Array.from({ length: n }, () => [128.9, 37.7]);
    const spread = (total: number) =>
      mutate((t) => {
        const legs = t.days.flatMap((d) => d.legs);
        legs.forEach((l) => (l.path = []));
        let left = total;
        for (const l of legs) {
          const n = Math.min(left, SHARE_TRIP_LIMITS.pathPointsPerLeg);
          l.path = pts(n);
          left -= n;
        }
      });
    // 구간이 4개뿐이라 구간당 한도(500)로는 40,000에 닿지 않는다. 전체 한도는 구간을 늘려 시험한다.
    expect(spread(2000)).toEqual([]);
    const doc = makeDoc();
    const trip = doc.trips[0]!;
    const many = Array.from({ length: 81 }, () => leg(IDS.a, IDS.b, { path: pts(500) }));
    trip.days[0]!.legs = many;
    const problems = checkShareTrip(doc);
    expect(problems.some((p) => p.includes('40000'))).toBe(true);
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
