import { describe, expect, it } from 'vitest';
import { TripSourceSchema } from 'src/schema/trip-source';

type SrcStop = { id?: string; place: string; time?: string; note?: string };

const base = () => ({
  schemaVersion: 1,
  title: '강릉 2박3일',
  startDate: '2026-11-14',
  endDate: '2026-11-16',
  folders: ['72815c89a7b241558581a0d907f133c1'],
  customPlaces: [{ key: 'start', name: '출발', lng: 126.9816, lat: 37.4765 }],
  days: [
    { date: '2026-11-14', stops: [{ id: 's7k2', place: 'start' }] as SrcStop[] },
    {
      date: '2026-11-15',
      stops: [{ id: 's9xa', place: '12028621', time: '12:00', note: '점심' }] as SrcStop[],
    },
  ],
});

type Src = ReturnType<typeof base>;
const cases: { name: string; mutate: (s: Src) => void; ok: boolean }[] = [
  { name: '기본 입력 통과', mutate: () => {}, ok: true },
  {
    name: 'startDate > endDate 거부',
    mutate: (s) => {
      s.startDate = '2026-11-17';
    },
    ok: false,
  },
  {
    name: '2026-02-30 거부',
    mutate: (s) => {
      s.startDate = '2026-02-30';
      s.endDate = '2026-03-02';
    },
    ok: false,
  },
  {
    name: '기간 밖 날짜 거부',
    mutate: (s) => {
      s.days[0]!.date = '2026-11-20';
    },
    ok: false,
  },
  {
    name: '날짜 중복 거부',
    mutate: (s) => {
      s.days[1]!.date = '2026-11-14';
    },
    ok: false,
  },
  {
    name: 'customPlace key 중복 거부',
    mutate: (s) => {
      s.customPlaces.push({ key: 'start', name: 'b', lng: 127, lat: 37 });
    },
    ok: false,
  },
  {
    name: '숫자만인 key 거부',
    mutate: (s) => {
      s.customPlaces[0]!.key = '123';
    },
    ok: false,
  },
  {
    name: 'lng 123.99 거부',
    mutate: (s) => {
      s.customPlaces[0]!.lng = 123.99;
    },
    ok: false,
  },
  {
    name: 'lng 124.0 통과',
    mutate: (s) => {
      s.customPlaces[0]!.lng = 124.0;
    },
    ok: true,
  },
  {
    name: 'lng 132.0 통과',
    mutate: (s) => {
      s.customPlaces[0]!.lng = 132.0;
    },
    ok: true,
  },
  {
    name: 'lng 132.01 거부',
    mutate: (s) => {
      s.customPlaces[0]!.lng = 132.01;
    },
    ok: false,
  },
  {
    name: 'lat 32.99 거부',
    mutate: (s) => {
      s.customPlaces[0]!.lat = 32.99;
    },
    ok: false,
  },
  {
    name: 'stops: [] 통과',
    mutate: (s) => {
      s.days[0]!.stops = [];
    },
    ok: true,
  },
  {
    name: 'time 25:00 거부',
    mutate: (s) => {
      s.days[1]!.stops[0]!.time = '25:00';
    },
    ok: false,
  },
  {
    name: '전체 stop id 중복 거부',
    mutate: (s) => {
      s.days[1]!.stops[0]!.id = 's7k2';
    },
    ok: false,
  },
];

describe('TripSourceSchema', () => {
  it.each(cases)('$name', ({ mutate, ok }) => {
    const s = base();
    mutate(s);
    expect(TripSourceSchema.safeParse(s).success).toBe(ok);
  });

  it('publish 생략 시 naverMemo === true', () => {
    const r = TripSourceSchema.parse(base());
    expect(r.publish.naverMemo).toBe(true);
  });

  it('publicId·stop id 생략 가능', () => {
    const s = base();
    s.days[0]!.stops = [{ place: 'start' }];
    expect(TripSourceSchema.safeParse(s).success).toBe(true);
  });

  it('날짜 오류는 해당 경로를 가리킨다', () => {
    const s = base();
    s.days[1]!.date = '2026-11-14';
    const r = TripSourceSchema.safeParse(s);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['days', 1, 'date']);
  });
});
