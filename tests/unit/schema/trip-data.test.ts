import { describe, expect, it } from 'vitest';
import { safeParse } from 'src/schema/parse';
import { TRIP_DATA_PARSE, TripDataSchema, type TripData } from 'src/schema/trip-data';
import { makeTrip, sid } from '../../fixtures/builders';

const trip = () =>
  structuredClone(makeTrip({ days: { '2026-11-14': ['X', 'Y', 'Z'], '2026-11-15': [] } }));

const failLeg = (t: TripData, extra: Record<string, unknown>) => {
  Object.assign(t.days[0]!.legs[0]!, {
    status: 'failed',
    distanceKind: 'straight',
    durationMs: null,
    staticDurationMs: null,
    tollFare: null,
    queriedAt: null,
    ...extra,
  });
};

const cases: { name: string; mutate: (t: TripData) => void; ok: boolean }[] = [
  { name: '빌더 기본값 통과', mutate: () => {}, ok: true },
  {
    name: '없는 placeKey 참조 거부',
    mutate: (t) => {
      t.days[0]!.stops[0]!.placeKey = 'n:999';
    },
    ok: false,
  },
  {
    name: '없는 folderId 거부',
    mutate: (t) => {
      t.places['n:1']!.folderIds = ['f9'];
    },
    ok: false,
  },
  {
    name: 'stops 0개·legs 0개 통과',
    mutate: (t) => {
      t.days[0]!.stops = [];
      t.days[0]!.legs = [];
    },
    ok: true,
  },
  {
    name: 'stops 1개·legs 0개 통과',
    mutate: (t) => {
      t.days[0]!.stops = t.days[0]!.stops.slice(0, 1);
      t.days[0]!.legs = [];
    },
    ok: true,
  },
  {
    name: 'legs 수 불일치 거부',
    mutate: (t) => {
      t.days[0]!.legs.pop();
    },
    ok: false,
  },
  {
    name: 'legs[0].toStopId 불일치 거부',
    mutate: (t) => {
      t.days[0]!.legs[0]!.toStopId = sid('Q');
    },
    ok: false,
  },
  {
    name: 'legs[0].fromPlaceKey 불일치 거부',
    mutate: (t) => {
      t.days[0]!.legs[0]!.fromPlaceKey = 'n:3';
    },
    ok: false,
  },
  {
    name: 'failed인데 durationMs 0 거부',
    mutate: (t) => {
      failLeg(t, { durationMs: 0 });
    },
    ok: false,
  },
  {
    name: 'failed인데 queriedAt이 있으면 거부',
    mutate: (t) => {
      failLeg(t, { queriedAt: '2026-10-03T00:00:00.000Z' });
    },
    ok: false,
  },
  {
    name: 'failed + null 조합 통과',
    mutate: (t) => {
      failLeg(t, {});
    },
    ok: true,
  },
  {
    name: 'dataVersion +09:00 거부',
    mutate: (t) => {
      t.dataVersion = '2026-10-03T10:00:00+09:00';
    },
    ok: false,
  },
  {
    name: 'stop id 중복 거부',
    mutate: (t) => {
      t.days[0]!.stops[1]!.id = t.days[0]!.stops[0]!.id;
    },
    ok: false,
  },
  {
    name: '날짜 중복 거부',
    mutate: (t) => {
      t.days[1]!.date = '2026-11-14';
    },
    ok: false,
  },
  {
    name: '기간 밖 날짜 거부',
    mutate: (t) => {
      t.days[1]!.date = '2026-12-01';
    },
    ok: false,
  },
];

describe('TripDataSchema', () => {
  it.each(cases)('$name', ({ mutate, ok }) => {
    const t = trip();
    mutate(t);
    expect(safeParse(TripDataSchema, t, TRIP_DATA_PARSE).success).toBe(ok);
  });

  it('빌더 결과가 스키마를 통과한다', () => {
    const t = makeTrip({ days: { '2026-11-14': ['X', 'Y'], '2026-11-15': [] } });
    expect(safeParse(TripDataSchema, t, TRIP_DATA_PARSE).success).toBe(true);
  });

  it('H와 H2는 같은 placeKey를 쓰고 stop id는 다르다', () => {
    const t = makeTrip({ days: { '2026-11-14': ['H', 'X', 'H2'] } });
    const [a, , c] = t.days[0]!.stops;
    expect(a!.placeKey).toBe(c!.placeKey);
    expect(a!.id).toBe('h000');
    expect(c!.id).toBe('h200');
  });

  it('folder에 shareId 같은 모르는 키가 있으면 거부한다', () => {
    const t = trip();
    t.folders = [{ id: 'f1', name: '폴더', count: 1 }];
    expect(safeParse(TripDataSchema, t, TRIP_DATA_PARSE).success).toBe(true);
    (t.folders[0] as Record<string, unknown>).shareId = 'fb65e7f93f8a4144a4ded594d604a7aa';
    const r = safeParse(TripDataSchema, t, TRIP_DATA_PARSE);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.issues[0]?.path).toBe('folders.0.shareId');
  });

  it('place에 shareId 같은 모르는 키가 있으면 거부한다', () => {
    const t = trip();
    const key = Object.keys(t.places)[0]!;
    (t.places[key] as Record<string, unknown>).shareId = 'fb65e7f93f8a4144a4ded594d604a7aa';
    const r = safeParse(TripDataSchema, t, TRIP_DATA_PARSE);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.issues[0]?.path).toBe(`places.${key}.shareId`);
  });

  it('rejects unknown key in folder and place', () => {
    const t = trip();
    t.folders = [{ id: 'f1', name: '폴더', count: 1 }];
    (t.folders[0] as Record<string, unknown>).shareId = 'x';
    expect(safeParse(TripDataSchema, t, TRIP_DATA_PARSE).success).toBe(false);
    t.folders = [{ id: 'f1', name: '폴더', count: 1 }];
    const key = Object.keys(t.places)[0]!;
    (t.places[key] as Record<string, unknown>).shareId = 'x';
    expect(safeParse(TripDataSchema, t, TRIP_DATA_PARSE).success).toBe(false);
    // 옵션 없이는 알 수 없는 키를 버린다(Effect 기본값). 호출부가 TRIP_DATA_PARSE를 넘겨야 한다.
    expect(safeParse(TripDataSchema, t).success).toBe(true);
  });

  it('legs 오류는 경로를 가리킨다', () => {
    const t = trip();
    t.days[0]!.legs.pop();
    const r = safeParse(TripDataSchema, t, TRIP_DATA_PARSE);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.issues[0]?.path).toBe('days.0.legs');
  });
});
