import { describe, expect, it } from 'vitest';
import {
  dayEndpoints,
  dayLegs,
  hiddenPlaceCount,
  legKey,
  liveTrips,
  locatePlace,
  tripDates,
  visibleCandidates,
  visibleStops,
} from 'src/domain/trips/query';
import { emptyLibrary, type Library, type Place } from 'src/schema/library';
import type { Stop, Trip } from 'src/schema/trip';

const T = '2026-10-08T01:00:00.000Z';
const f = <V>(value: V) => ({ value, updatedAt: T });

const pid = (n: number) => `p${String(n).padStart(9, '0')}`;

/** 경도가 n에 비례해 벌어진다(위도 37.5에서 0.001도 ≈ 88m). */
function place(n: number, over: Partial<Place> = {}): Place {
  return {
    id: pid(n),
    source: { kind: 'naver', sid: String(1000 + n) },
    name: f(`장소 ${n}`),
    address: '강원 강릉시 창해로 14번길 20',
    lng: 128 + n * 0.1,
    lat: 37.5,
    category: f<string | null>(null),
    labelIds: f<string[]>([]),
    memo: f(''),
    saved: f(true),
    createdAt: T,
    deletedAt: null,
    ...over,
  };
}

function stop(n: number, placeN: number): Stop {
  return {
    id: `s${String(n).padStart(7, '0')}`,
    placeId: pid(placeN),
    stayMin: 60,
    fixedTime: null,
    note: '',
  };
}

function day(stops: Stop[] = [], lodging: string | null = null) {
  return { stops: f(stops), lodging: f(lodging), startTime: f('09:00') };
}

let tripSeq = 1;
function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: `t${String(tripSeq++).padStart(9, '0')}`,
    title: f('강릉'),
    startDate: f('2026-10-20'),
    endDate: f('2026-10-21'),
    origin: f<string | null>(null),
    candidates: f<string[]>([]),
    days: [day(), day()],
    legModes: f<Record<string, 'car' | 'walk'>>({}),
    createdAt: T,
    deletedAt: null,
    ...over,
  };
}

function library(places: Place[], trips: Trip[] = []): Library {
  return {
    ...emptyLibrary(),
    places: Object.fromEntries(places.map((p) => [p.id, p])),
    trips: Object.fromEntries(trips.map((t) => [t.id, t])),
  };
}

const PLACES = [1, 2, 3, 4, 5, 6].map((n) => place(n));
const lib = library(PLACES);
const tomb = (n: number) => place(n, { deletedAt: T });

describe('legKey', () => {
  it('"from>to" 형식', () => {
    expect(legKey('a', 'b')).toBe('a>b');
  });
});

describe('tripDates', () => {
  it('시작일~종료일을 모두 나열한다', () => {
    expect(tripDates(trip())).toEqual(['2026-10-20', '2026-10-21']);
  });

  it('달·해를 넘겨도 맞다', () => {
    const t = trip({ startDate: f('2026-12-30'), endDate: f('2027-01-02') });
    expect(tripDates(t)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });

  it('같은 날이면 하루', () => {
    expect(tripDates(trip({ startDate: f('2026-10-20'), endDate: f('2026-10-20') }))).toEqual([
      '2026-10-20',
    ]);
  });
});

describe('liveTrips', () => {
  const t = (id: string, start: string, end: string, over: Partial<Trip> = {}) =>
    trip({ id, startDate: f(start), endDate: f(end), ...over });

  it('시작일 오름차순, 이미 끝난 여행은 뒤로, 묘비는 뺀다', () => {
    const library_ = library(
      [],
      [
        t('t000000001', '2026-09-01', '2026-09-03'), // 지난 여행
        t('t000000002', '2026-11-10', '2026-11-12'),
        t('t000000003', '2026-10-12', '2026-10-14'), // 오늘 시작
        t('t000000004', '2026-08-01', '2026-08-02'), // 더 먼 과거
        t('t000000005', '2026-10-01', '2026-10-05', { deletedAt: T }),
        t('t000000006', '2026-10-01', '2026-10-12'), // 오늘 끝남 → 아직 지난 게 아니다
      ],
    );
    expect(liveTrips(library_, '2026-10-12').map((x) => x.id)).toEqual([
      't000000006',
      't000000003',
      't000000002',
      't000000004',
      't000000001',
    ]);
  });

  it('시작일이 같으면 id 순', () => {
    const library_ = library(
      [],
      [t('t000000009', '2026-11-01', '2026-11-02'), t('t000000008', '2026-11-01', '2026-11-02')],
    );
    expect(liveTrips(library_, '2026-10-12').map((x) => x.id)).toEqual([
      't000000008',
      't000000009',
    ]);
  });

  it('today를 생략해도 동작한다', () => {
    const library_ = library([], [t('t000000001', '2000-01-01', '2000-01-02')]);
    expect(liveTrips(library_)).toHaveLength(1);
  });
});

describe('visibleStops / visibleCandidates / hiddenPlaceCount', () => {
  const d = day([stop(1, 1), stop(2, 2), stop(3, 3)]);
  const lib2 = library([PLACES[0]!, tomb(2), PLACES[2]!]);

  it('묘비 장소의 Stop은 건너뛴다', () => {
    expect(visibleStops(lib2, d).map((s) => s.placeId)).toEqual([pid(1), pid(3)]);
  });

  it('보관함에 아예 없는 장소도 건너뛴다', () => {
    const d2 = day([stop(1, 1), stop(2, 99)]);
    expect(visibleStops(lib2, d2).map((s) => s.placeId)).toEqual([pid(1)]);
  });

  it('되살리면 원래 자리로 돌아온다', () => {
    const alive = library(PLACES.slice(0, 3));
    expect(visibleStops(alive, d).map((s) => s.placeId)).toEqual([pid(1), pid(2), pid(3)]);
  });

  it('후보도 묘비를 뺀다', () => {
    const t = trip({ candidates: f([pid(3), pid(2), pid(1)]) });
    expect(visibleCandidates(lib2, t).map((p) => p.id)).toEqual([pid(3), pid(1)]);
  });

  it('숨겨진 장소 수는 후보·Stop·출발지·숙소를 통틀어 장소 기준으로 센다', () => {
    const lib3 = library([PLACES[0]!, tomb(2), tomb(3), tomb(4), PLACES[4]!]);
    const t = trip({
      origin: f<string | null>(pid(4)),
      candidates: f([pid(2), pid(5)]),
      days: [day([stop(1, 3), stop(2, 1)], pid(2)), day([stop(3, 3)])],
    });
    // 2(후보+숙소), 3(두 Stop), 4(출발지) → 3곳
    expect(hiddenPlaceCount(lib3, t)).toBe(3);
  });

  it('숨겨진 장소가 없으면 0', () => {
    expect(hiddenPlaceCount(lib, trip({ candidates: f([pid(1)]) }))).toBe(0);
  });
});

describe('dayEndpoints', () => {
  const t = trip({
    origin: f<string | null>(pid(1)),
    days: [day([], pid(2)), day([], pid(3)), day([], null)],
    startDate: f('2026-10-20'),
    endDate: f('2026-10-22'),
  });

  it('첫날 출발점은 origin, 도착점은 그날 숙소', () => {
    const e = dayEndpoints(lib, t, 0);
    expect(e.start?.id).toBe(pid(1));
    expect(e.end?.id).toBe(pid(2));
  });

  it('다음 날 출발점은 전날 숙소', () => {
    const e = dayEndpoints(lib, t, 1);
    expect(e.start?.id).toBe(pid(2));
    expect(e.end?.id).toBe(pid(3));
  });

  it('마지막 날 도착점은 그날 lodging(도착지), 없으면 null', () => {
    const e = dayEndpoints(lib, t, 2);
    expect(e.start?.id).toBe(pid(3));
    expect(e.end).toBeNull();
    const t2 = trip({ days: [day([], pid(2)), day([], pid(5))] });
    expect(dayEndpoints(lib, t2, 1).end?.id).toBe(pid(5));
  });

  it('origin이 없으면 첫날 출발점 null', () => {
    expect(dayEndpoints(lib, trip({ days: [day(), day()] }), 0).start).toBeNull();
  });

  it('묘비 숙소·출발지는 없는 것으로 본다', () => {
    const lib2 = library([tomb(1), tomb(2), PLACES[2]!]);
    expect(dayEndpoints(lib2, t, 0)).toEqual({ start: null, end: null });
    expect(dayEndpoints(lib2, t, 1).start).toBeNull();
    expect(dayEndpoints(lib2, t, 1).end?.id).toBe(pid(3));
  });

  it('범위 밖 dayIndex는 둘 다 null', () => {
    expect(dayEndpoints(lib, t, 9)).toEqual({ start: null, end: null });
    expect(dayEndpoints(lib, t, -1)).toEqual({ start: null, end: null });
  });
});

describe('dayLegs', () => {
  const ids = (legs: ReturnType<typeof dayLegs>) => legs.map((l) => [l.from.id, l.to.id]);

  it('출발·도착이 모두 있으면 [출발, Stop…, 도착]의 이웃 쌍', () => {
    const t = trip({
      origin: f<string | null>(pid(1)),
      days: [day([stop(1, 2), stop(2, 3)], pid(4)), day()],
    });
    expect(ids(dayLegs(lib, t, 0))).toEqual([
      [pid(1), pid(2)],
      [pid(2), pid(3)],
      [pid(3), pid(4)],
    ]);
  });

  it('출발점만 있으면 도착 구간이 없다', () => {
    const t = trip({
      origin: f<string | null>(pid(1)),
      days: [day([stop(1, 2), stop(2, 3)]), day()],
    });
    expect(ids(dayLegs(lib, t, 0))).toEqual([
      [pid(1), pid(2)],
      [pid(2), pid(3)],
    ]);
  });

  it('도착점만 있으면 출발 구간이 없다', () => {
    const t = trip({ days: [day([stop(1, 2), stop(2, 3)], pid(4)), day()] });
    expect(ids(dayLegs(lib, t, 0))).toEqual([
      [pid(2), pid(3)],
      [pid(3), pid(4)],
    ]);
  });

  it('둘 다 없으면 Stop끼리만', () => {
    const t = trip({ days: [day([stop(1, 2), stop(2, 3), stop(3, 4)]), day()] });
    expect(ids(dayLegs(lib, t, 0))).toEqual([
      [pid(2), pid(3)],
      [pid(3), pid(4)],
    ]);
  });

  it('Stop이 1곳이고 출발·도착이 없으면 구간 없음', () => {
    const t = trip({ days: [day([stop(1, 2)]), day()] });
    expect(dayLegs(lib, t, 0)).toEqual([]);
  });

  it('Stop 0곳: 출발·도착이 모두 있으면 구간 하나', () => {
    const t = trip({ origin: f<string | null>(pid(1)), days: [day([], pid(2)), day()] });
    expect(ids(dayLegs(lib, t, 0))).toEqual([[pid(1), pid(2)]]);
  });

  it('Stop 0곳: 하나만 있거나 없으면 구간 없음', () => {
    expect(dayLegs(lib, trip({ origin: f<string | null>(pid(1)) }), 0)).toEqual([]);
    expect(dayLegs(lib, trip({ days: [day([], pid(2)), day()] }), 0)).toEqual([]);
    expect(dayLegs(lib, trip(), 0)).toEqual([]);
  });

  it('둘째 날은 전날 숙소에서 출발한다', () => {
    const t = trip({ days: [day([], pid(2)), day([stop(1, 3)], pid(4))] });
    expect(ids(dayLegs(lib, t, 1))).toEqual([
      [pid(2), pid(3)],
      [pid(3), pid(4)],
    ]);
  });

  it('묘비 Stop은 건너뛰어 앞뒤를 잇고, 되살리면 원래대로 돌아온다', () => {
    const t = trip({
      origin: f<string | null>(pid(1)),
      days: [day([stop(1, 2), stop(2, 3), stop(3, 4)], pid(5)), day()],
    });
    const lib2 = library([PLACES[0]!, PLACES[1]!, tomb(3), PLACES[3]!, PLACES[4]!]);
    expect(ids(dayLegs(lib2, t, 0))).toEqual([
      [pid(1), pid(2)],
      [pid(2), pid(4)],
      [pid(4), pid(5)],
    ]);
    expect(ids(dayLegs(lib, t, 0))).toEqual([
      [pid(1), pid(2)],
      [pid(2), pid(3)],
      [pid(3), pid(4)],
      [pid(4), pid(5)],
    ]);
  });

  it('Stop이 모두 묘비이면 출발·도착을 바로 잇는다', () => {
    const t = trip({
      origin: f<string | null>(pid(1)),
      days: [day([stop(1, 2)], pid(3)), day()],
    });
    const lib2 = library([PLACES[0]!, tomb(2), PLACES[2]!]);
    expect(ids(dayLegs(lib2, t, 0))).toEqual([[pid(1), pid(3)]]);
  });

  it('묘비 출발지는 없는 것으로 보고 첫 Stop에서 시작한다', () => {
    const t = trip({
      origin: f<string | null>(pid(1)),
      days: [day([stop(1, 2), stop(2, 3)]), day()],
    });
    const lib2 = library([tomb(1), PLACES[1]!, PLACES[2]!]);
    expect(ids(dayLegs(lib2, t, 0))).toEqual([[pid(2), pid(3)]]);
  });

  it('구간 정보: 키·직선거리·자동 수단', () => {
    const t = trip({ days: [day([stop(1, 1), stop(2, 2)]), day()] });
    const [leg] = dayLegs(lib, t, 0);
    expect(leg!.key).toBe(legKey(pid(1), pid(2)));
    // 경도 0.1도 ≈ 8.8km
    expect(leg!.straightM).toBeGreaterThan(8_000);
    expect(leg!.straightM).toBeLessThan(9_500);
    expect(leg!.mode).toBe('car');
    expect(leg!.modeSource).toBe('auto');
    expect(leg!.walkAllowed).toBe(true);
  });

  it('가까운 구간(800m 이하)은 자동으로 도보', () => {
    const near = [place(1, { lng: 128.0 }), place(2, { lng: 128.005 })]; // 약 440m
    const t = trip({ days: [day([stop(1, 1), stop(2, 2)]), day()] });
    const [leg] = dayLegs(library(near), t, 0);
    expect(leg!.straightM).toBeLessThan(800);
    expect(leg!.mode).toBe('walk');
    expect(leg!.modeSource).toBe('auto');
  });

  it('legModes에 사람이 고른 값이 있으면 우선한다', () => {
    const near = [place(1, { lng: 128.0 }), place(2, { lng: 128.005 })];
    const t = trip({
      days: [day([stop(1, 1), stop(2, 2)]), day()],
      legModes: f<Record<string, 'car' | 'walk'>>({ [legKey(pid(1), pid(2))]: 'car' }),
    });
    const [leg] = dayLegs(library(near), t, 0);
    expect(leg!.mode).toBe('car');
    expect(leg!.modeSource).toBe('user');

    const far = trip({
      days: [day([stop(1, 1), stop(2, 2)]), day()],
      legModes: f<Record<string, 'car' | 'walk'>>({ [legKey(pid(1), pid(2))]: 'walk' }),
    });
    const [leg2] = dayLegs(lib, far, 0);
    expect(leg2!.mode).toBe('walk');
    expect(leg2!.modeSource).toBe('user');
    expect(leg2!.walkAllowed).toBe(true);
  });

  it('방향이 다른 키는 적용하지 않는다', () => {
    const t = trip({
      days: [day([stop(1, 1), stop(2, 2)]), day()],
      legModes: f<Record<string, 'car' | 'walk'>>({ [legKey(pid(2), pid(1))]: 'walk' }),
    });
    expect(dayLegs(lib, t, 0)[0]!.mode).toBe('car');
  });

  it('직선 50km 초과면 사람이 고른 walk라도 car, walkAllowed false', () => {
    const farPlaces = [place(1, { lng: 127.0 }), place(2, { lng: 128.0 })]; // 약 88km
    const t = trip({
      days: [day([stop(1, 1), stop(2, 2)]), day()],
      legModes: f<Record<string, 'car' | 'walk'>>({ [legKey(pid(1), pid(2))]: 'walk' }),
    });
    const [leg] = dayLegs(library(farPlaces), t, 0);
    expect(leg!.straightM).toBeGreaterThan(50_000);
    expect(leg!.mode).toBe('car');
    expect(leg!.walkAllowed).toBe(false);
    expect(leg!.modeSource).toBe('auto');
  });

  it('같은 좌표의 두 장소는 직선 0(NaN 없음)이고 구간으로 남는다', () => {
    const same = [place(1, { lng: 128, lat: 37.5 }), place(2, { lng: 128, lat: 37.5 })];
    const t = trip({ days: [day([stop(1, 1), stop(2, 2)]), day()] });
    const [leg] = dayLegs(library(same), t, 0);
    expect(leg!.straightM).toBe(0);
    expect(leg!.mode).toBe('walk');
  });

  it('범위 밖 dayIndex는 빈 배열', () => {
    expect(dayLegs(lib, trip(), 5)).toEqual([]);
  });
});

describe('locatePlace', () => {
  const t = trip({
    candidates: f([pid(5), pid(6)]),
    days: [day([stop(1, 1), stop(2, 2)]), day([stop(3, 3)])],
  });

  it('후보', () => {
    expect(locatePlace(t, pid(6))).toEqual({ where: 'candidate' });
  });

  it('Day와 순번', () => {
    expect(locatePlace(t, pid(2))).toEqual({ where: 'day', dayIndex: 0, stopIndex: 1 });
    expect(locatePlace(t, pid(3))).toEqual({ where: 'day', dayIndex: 1, stopIndex: 0 });
  });

  it('여행에 없으면 null', () => {
    expect(locatePlace(t, pid(4))).toBeNull();
  });

  it('숙소·출발지만인 장소는 null(Stop·후보가 아니다)', () => {
    const t2 = trip({ origin: f<string | null>(pid(4)), days: [day([], pid(4)), day()] });
    expect(locatePlace(t2, pid(4))).toBeNull();
  });
});
