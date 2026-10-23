import { describe, expect, it } from 'vitest';
import { checkShareTrip, dayPoints } from 'src/domain/share/check-share-trip';
import { computeSchedule } from 'src/domain/trips/schedule';
import type { ShareDocV2, ShareLeg } from 'src/schema/share';
import { dayView, placeIdOfPin, tripPins, type DayRow } from 'src/share-viewer/trip-view';
import { IDS, leg, makeShareV2Doc } from '../helpers/share-v2-doc';

function day0(doc: ShareDocV2) {
  return doc.trips[0]!.days[0]!;
}

function setup(legs: Partial<ShareLeg>[]): ShareDocV2 {
  const doc = makeShareV2Doc();
  const d = day0(doc);
  d.legs = d.legs.map((l, i) => ({ ...l, ...legs[i] }));
  return doc;
}

describe('dayView', () => {
  it('출발지·숙소·Stop 2곳: 행 순서와 시각이 computeSchedule과 같다', () => {
    const doc = setup([{ durationS: 600 }, { durationS: 900, mode: 'walk' }, { durationS: 300 }]);
    const trip = doc.trips[0]!;
    const view = dayView(trip, 0);
    const expected = computeSchedule({
      startTime: '09:00',
      hasStart: true,
      stops: [
        { stayMin: 60, fixedTime: null },
        { stayMin: null, fixedTime: '12:00' },
      ],
      hasEnd: true,
      legs: [600, 900, 300].map((durationS) => ({
        durationS,
        distanceM: 5000,
        tollFare: null,
        estimated: false,
      })),
    });
    expect(view.date).toBe('2026-10-24');
    expect(view.rows.map((r) => r.kind)).toEqual([
      'start',
      'leg',
      'stop',
      'leg',
      'stop',
      'leg',
      'end',
    ]);
    const [start, , a, , b, , end] = view.rows as [
      Extract<DayRow, { kind: 'start' }>,
      DayRow,
      Extract<DayRow, { kind: 'stop' }>,
      DayRow,
      Extract<DayRow, { kind: 'stop' }>,
      DayRow,
      Extract<DayRow, { kind: 'end' }>,
    ];
    expect(start).toMatchObject({
      placeId: IDS.home,
      icon: '🏠',
      departMin: expected.points[0]!.departMin,
    });
    expect(a).toMatchObject({
      number: 1,
      arriveMin: expected.points[1]!.arriveMin,
      departMin: expected.points[1]!.departMin,
      slackMin: null,
    });
    expect(a.stop.placeId).toBe(IDS.a);
    expect(b).toMatchObject({
      number: 2,
      arriveMin: expected.points[2]!.arriveMin,
      departMin: expected.points[2]!.departMin,
      slackMin: expected.points[2]!.slackMin,
    });
    expect(end).toMatchObject({ placeId: IDS.hotel, arriveMin: expected.points[3]!.arriveMin });
    expect(view.totals).toEqual(expected.totals);
    expect(view.hasLegs).toBe(true);
  });

  it('2일차 출발점은 전날 숙소(🛏)', () => {
    const view = dayView(makeShareV2Doc().trips[0]!, 1);
    expect(view.date).toBe('2026-10-25');
    expect(view.rows[0]).toMatchObject({
      kind: 'start',
      placeId: IDS.hotel,
      icon: '🛏',
      departMin: 570,
    });
    expect(view.rows.at(-1)!.kind).toBe('stop');
  });

  it('출발점이 없으면 첫 행이 no-start이고 첫 장소는 출발 시각에 도착한다', () => {
    const doc = makeShareV2Doc();
    const trip = doc.trips[0]!;
    trip.originId = null;
    trip.days[0]!.legs = trip.days[0]!.legs.slice(1);
    const view = dayView(trip, 0);
    expect(view.rows[0]).toEqual({ kind: 'no-start', departMin: 540 });
    expect(view.rows[1]).toMatchObject({ kind: 'stop', number: 1, arriveMin: 540, departMin: 600 });
  });

  it('출발지 id가 빈 문자열이면 dayPoints처럼 출발점이 없다(행·핀 모두)', () => {
    const doc = makeShareV2Doc();
    const trip = doc.trips[0]!;
    trip.originId = '';
    trip.days[0]!.legs = trip.days[0]!.legs.slice(1);
    expect(dayView(trip, 0).rows[0]).toEqual({ kind: 'no-start', departMin: 540 });
    const { pins } = tripPins(doc, { kind: 'day', dayIndex: 0 });
    expect(pins.filter((p) => p.id.startsWith('start:'))).toEqual([]);
  });

  it('숙소 id가 빈 문자열이면 관계 검사·dayPoints처럼 도착점이 없다(행·핀 모두)', () => {
    // 장소 'a'와 '', Stop 'a', 숙소 '', 구간 없음: 관계 검사를 통과하는 문서.
    const doc = makeShareV2Doc();
    const a = doc.places.find((p) => p.id === IDS.a)!;
    doc.places = [a, { ...a, id: '', name: '빈 id 장소' }];
    const trip = doc.trips[0]!;
    trip.endDate = trip.startDate;
    trip.originId = null;
    trip.candidateIds = [];
    trip.legModes = {};
    trip.days = [
      {
        startTime: '09:00',
        lodgingId: '',
        stops: [{ placeId: IDS.a, stayMin: 60, fixedTime: null }],
        legs: [],
      },
    ];
    expect(checkShareTrip(doc)).toEqual([]);
    expect(dayPoints(trip, 0)).toEqual([IDS.a]);

    const view = dayView(trip, 0);
    expect(view.rows.map((r) => r.kind)).toEqual(['no-start', 'stop']);
    expect(view.hasLegs).toBe(false);
    const { pins } = tripPins(doc, { kind: 'day', dayIndex: 0 });
    expect(pins.filter((p) => p.id.startsWith('end:'))).toEqual([]);
    expect(pins.map((p) => p.id)).toEqual([IDS.a]);

    // 빈 숙소로 가는 구간을 넣으면 관계 검사가 거절한다(셋이 같은 규칙).
    trip.days[0]!.legs = [leg(IDS.a, '')];
    expect(checkShareTrip(doc).length).toBeGreaterThan(0);
  });

  it('고정 10:00인데 10:20에 도착하면 slackMin은 -20', () => {
    const doc = setup([{ durationS: 4800 }]); // 09:00 + 80분 = 10:20
    day0(doc).stops[0]!.fixedTime = '10:00';
    const stop = dayView(doc.trips[0]!, 0).rows.find((r) => r.kind === 'stop')!;
    expect(stop).toMatchObject({ arriveMin: 620, slackMin: -20 });
  });

  it('출발 23:00에 구간 2시간이면 도착은 1500', () => {
    const doc = setup([{ durationS: 7200 }]);
    day0(doc).startTime = '23:00';
    const stop = dayView(doc.trips[0]!, 0).rows.find((r) => r.kind === 'stop')!;
    expect(stop).toMatchObject({ arriveMin: 1500 });
  });

  it('same-point 구간은 leg 행이 없고 시간이 0이다', () => {
    const trip = makeShareV2Doc().trips[0]!;
    // 출발지=숙소, 장소 없음 → 같은 지점 구간 하나(dayView는 관계 검사를 하지 않는다).
    trip.days[0] = {
      startTime: '09:00',
      lodgingId: IDS.home,
      stops: [],
      legs: [
        leg(IDS.home, IDS.home, {
          status: 'same-point',
          durationS: 0,
          distanceM: 0,
          queriedAt: null,
          path: [],
        }),
      ],
    };
    const view = dayView(trip, 0);
    expect(view.rows).toEqual([
      { kind: 'start', placeId: IDS.home, icon: '🏠', departMin: 540 },
      { kind: 'end', placeId: IDS.home, arriveMin: 540 },
    ]);
    expect(view.hasLegs).toBe(false);
    expect(view.totals.travelS).toBe(0);
  });

  it('same-point 구간에 시간이 적혀 있어도 0으로 본다', () => {
    const doc = setup([
      { durationS: 600 },
      { durationS: 600 },
      { status: 'same-point', durationS: 900, queriedAt: null, path: [] },
    ]);
    const end = dayView(doc.trips[0]!, 0).rows.at(-1)!;
    // 09:00 + 10분 + 체류 60분 + 10분 = 10:20(고정 12:00까지 기다려 12:00 출발) → 숙소 도착 12:00
    expect(end).toEqual({ kind: 'end', placeId: IDS.hotel, arriveMin: 720 });
  });

  it('estimated·no-route 구간이 있으면 totals.approximate', () => {
    expect(dayView(makeShareV2Doc().trips[0]!, 0).totals.approximate).toBe(false);
    expect(
      dayView(setup([{ status: 'estimated', queriedAt: null, path: [] }]).trips[0]!, 0).totals
        .approximate,
    ).toBe(true);
    expect(
      dayView(setup([{}, { status: 'no-route', queriedAt: null, path: [] }]).trips[0]!, 0).totals
        .approximate,
    ).toBe(true);
  });

  it('oldestQueriedAt은 routed 구간 조회 시각 중 가장 이른 것', () => {
    const doc = setup([
      { queriedAt: '2026-10-16T04:58:00.000Z' },
      { queriedAt: '2026-10-15T01:00:00.000Z' },
      { status: 'estimated', queriedAt: null, path: [] },
    ]);
    expect(dayView(doc.trips[0]!, 0).oldestQueriedAt).toBe('2026-10-15T01:00:00.000Z');
  });

  it('받은 경로가 없으면 oldestQueriedAt은 null', () => {
    const doc = setup(
      [0, 1, 2].map(() => ({ status: 'estimated' as const, queriedAt: null, path: [] })),
    );
    expect(dayView(doc.trips[0]!, 0).oldestQueriedAt).toBeNull();
  });

  it('장소가 없는 Day는 출발점·숙소 행만 있다', () => {
    const doc = makeShareV2Doc();
    const trip = doc.trips[0]!;
    trip.days[1]!.stops = [];
    trip.days[1]!.legs = [];
    trip.days[1]!.lodgingId = null;
    trip.candidateIds.push(IDS.c);
    const view = dayView(trip, 1);
    expect(view.rows.map((r) => r.kind)).toEqual(['start']);
    expect(view.hasLegs).toBe(false);
  });
});

describe('tripPins', () => {
  it('Day 탭: Stop 번호·출발점·숙소·다른 Day 점', () => {
    const doc = makeShareV2Doc();
    const { pins, lines } = tripPins(doc, { kind: 'day', dayIndex: 0 });
    const byId = new Map(pins.map((p) => [p.id, p]));
    expect(new Set(pins.map((p) => p.id)).size).toBe(pins.length);
    expect(byId.get(IDS.a)).toMatchObject({ label: '1 장소 2', day: 0, role: 'stop' });
    expect(byId.get(IDS.b)).toMatchObject({ label: '2 장소 3', day: 0, role: 'stop' });
    expect(byId.get(`start:${IDS.home}`)).toMatchObject({
      label: '🏠 장소 0',
      day: 0,
      role: 'endpoint',
    });
    expect(byId.get(`end:${IDS.hotel}`)).toMatchObject({
      label: '🛏 장소 1',
      day: 0,
      role: 'endpoint',
    });
    expect(byId.get(IDS.c)).toMatchObject({ label: '장소 4', day: 1, role: 'dim' });
    expect(byId.has(IDS.d)).toBe(false); // 후보는 Day 탭에 없다
    expect(lines.map((l) => l.id)).toEqual([
      `${IDS.home}>${IDS.a}`,
      `${IDS.a}>${IDS.b}`,
      `${IDS.b}>${IDS.hotel}`,
    ]);
    expect(lines.map((l) => l.walk)).toEqual([false, true, false]);
    expect(lines.every((l) => l.day === 0)).toBe(true);
  });

  it('출발점과 숙소가 같은 장소면 핀이 하나', () => {
    const doc = makeShareV2Doc();
    const d = day0(doc);
    d.lodgingId = IDS.home;
    d.legs[2] = leg(IDS.b, IDS.home);
    const { pins } = tripPins(doc, { kind: 'day', dayIndex: 0 });
    expect(pins.filter((p) => p.role === 'endpoint').map((p) => p.id)).toEqual([
      `start:${IDS.home}`,
    ]);
  });

  it('2일차: 출발점은 전날 숙소 🛏, 전날 Stop은 흐린 점(day 0)', () => {
    const { pins } = tripPins(makeShareV2Doc(), { kind: 'day', dayIndex: 1 });
    expect(pins.find((p) => p.id === `start:${IDS.hotel}`)).toMatchObject({
      label: '🛏 장소 1',
      day: 1,
    });
    expect(pins.find((p) => p.id === IDS.a)).toMatchObject({
      label: '장소 2',
      day: 0,
      role: 'dim',
    });
    expect(pins.find((p) => p.id === IDS.c)).toMatchObject({
      label: '1 장소 4',
      day: 1,
      role: 'stop',
    });
  });

  it('routed 구간은 받은 경로, 아니면 두 점 직선', () => {
    const doc = makeShareV2Doc();
    day0(doc).legs[1] = leg(IDS.a, IDS.b, {
      mode: 'walk',
      status: 'estimated',
      queriedAt: null,
      path: [],
    });
    const { lines } = tripPins(doc, { kind: 'day', dayIndex: 0 });
    expect(lines[0]!.path).toEqual([
      [128.9, 37.7],
      [128.91, 37.71],
    ]);
    const a = doc.places.find((p) => p.id === IDS.a)!;
    const b = doc.places.find((p) => p.id === IDS.b)!;
    expect(lines[1]!.path).toEqual([
      [a.lng, a.lat],
      [b.lng, b.lat],
    ]);
  });

  it('same-point 구간은 선이 없다', () => {
    const doc = makeShareV2Doc();
    day0(doc).legs[2] = leg(IDS.b, IDS.hotel, {
      status: 'same-point',
      durationS: 0,
      distanceM: 0,
      queriedAt: null,
      path: [],
    });
    const { lines } = tripPins(doc, { kind: 'day', dayIndex: 0 });
    expect(lines.map((l) => l.id)).toEqual([`${IDS.home}>${IDS.a}`, `${IDS.a}>${IDS.b}`]);
  });

  it('같은 from>to 쌍이 두 번이면 선 id가 겹치지 않는다', () => {
    const doc = makeShareV2Doc();
    const d = day0(doc);
    doc.trips[0]!.originId = IDS.a;
    d.stops = [{ placeId: IDS.a, stayMin: null, fixedTime: null }];
    d.lodgingId = IDS.a;
    d.legs = [leg(IDS.a, IDS.a), leg(IDS.a, IDS.a)];
    const { lines } = tripPins(doc, { kind: 'day', dayIndex: 0 });
    expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
  });

  it('후보 탭: 후보만 회색(day null)·이름만, 선 없음', () => {
    const { pins, lines } = tripPins(makeShareV2Doc(), { kind: 'candidates' });
    const d = makeShareV2Doc().places.find((p) => p.id === IDS.d)!;
    expect(pins).toEqual([
      { id: IDS.d, label: d.name, lng: d.lng, lat: d.lat, day: null, role: 'stop' },
    ]);
    expect(lines).toEqual([]);
  });

  it('범위 밖 Day는 빈 결과(흐린 점만 남지 않는다)', () => {
    const { pins, lines } = tripPins(makeShareV2Doc(), { kind: 'day', dayIndex: 9 });
    expect(lines).toEqual([]);
    expect(pins.every((p) => p.role === 'dim')).toBe(true);
  });
});

describe('placeIdOfPin', () => {
  it('start:·end: 접두사를 뗀다', () => {
    expect(placeIdOfPin('start:abc')).toBe('abc');
    expect(placeIdOfPin('end:abc')).toBe('abc');
    expect(placeIdOfPin('abc')).toBe('abc');
  });
});
