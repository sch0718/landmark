// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dayLegs, legKey } from 'src/domain/trips/query';
import { LibrarySchema } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { buildLibrary, checkLegModes } from '../../../../pipeline/agent-trip/build-library';
import { EXIT, TripFailure, type TripIssue } from '../../../../pipeline/agent-trip/errors';
import type { TripPlan } from '../../../../pipeline/agent-trip/plan-schema';
import type { ResolvedPlace } from '../../../../pipeline/agent-trip/resolve-places';

const NOW = new Date('2026-11-01T05:12:00.000Z');
const fixture = JSON.parse(
  readFileSync(new URL('../../../fixtures/agent-trip/plan.json', import.meta.url), 'utf8'),
) as TripPlan;
const plan = (): TripPlan => structuredClone(fixture);
const resolved = (p: TripPlan): ResolvedPlace[] =>
  p.places.map((place, index) => ({
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

function failure(p: TripPlan, places = resolved(p)): TripFailure {
  try {
    buildLibrary(p, places, NOW, []);
  } catch (error) {
    expect(error).toBeInstanceOf(TripFailure);
    return error as TripFailure;
  }
  throw new Error('계획 오류가 나야 해요');
}

describe('계획으로 메모리 보관함 만들기', () => {
  it('고정 계획의 장소·여행·Stop 설정을 앱 연산으로 만든다', () => {
    const p = plan();
    const before = structuredClone(p);
    const places = resolved(p);
    const beforePlaces = structuredClone(places);
    const warnings: TripIssue[] = [];
    const built = buildLibrary(p, places, NOW, warnings);
    const { lib, tripId, placeIds } = built;
    const trip = lib.trips[tripId]!;
    expect(safeParse(LibrarySchema, lib).success).toBe(true);
    expect(built.now).toBe(NOW.toISOString());
    expect(tripId).toMatch(/^[a-z0-9]{10}$/);
    expect(placeIds.size).toBe(5);
    expect(Object.keys(lib.places)).toHaveLength(5);
    for (const place of places) {
      const id = placeIds.get(place.key)!;
      expect(id).toMatch(/^[a-z0-9]{10}$/);
      expect(lib.places[id]).toMatchObject({
        source: { kind: 'pin' },
        name: { value: place.candidate.name, updatedAt: built.now },
        memo: { value: place.memo, updatedAt: built.now },
        createdAt: built.now,
      });
    }
    expect(trip.title.value).toBe(p.title);
    expect(trip.origin.value).toBe(placeIds.get('gangnam'));
    expect(trip.startDate.value).toBe(p.startDate);
    expect(trip.endDate.value).toBe(p.endDate);
    expect(trip.days).toHaveLength(2);
    expect(trip.days[0]!.stops.value).toEqual([
      {
        id: expect.stringMatching(/^[a-z0-9]{8}$/),
        placeId: placeIds.get('tofu'),
        stayMin: 60,
        fixedTime: '12:00',
        note: '영업시간 확인 필요',
      },
      {
        id: expect.stringMatching(/^[a-z0-9]{8}$/),
        placeId: placeIds.get('beach'),
        stayMin: 90,
        fixedTime: null,
        note: '',
      },
    ]);
    expect(trip.days[0]!.lodging.value).toBe(placeIds.get('hotel'));
    expect(trip.days[1]!.lodging.value).toBe(placeIds.get('gangnam'));
    expect(trip.days[1]!.startTime.value).toBe('10:00');
    expect(trip.legModes.value).toEqual({
      [legKey(placeIds.get('tofu')!, placeIds.get('beach')!)]: 'walk',
    });
    expect(dayLegs(lib, trip, 0)[1]!.mode).toBe('walk');
    expect(warnings).toEqual([]);
    expect(p).toEqual(before);
    expect(places).toEqual(beforePlaces);
  });

  it('선택값이 없으면 앱 기본값을 쓰고 0·null 체류와 후보를 보존한다', () => {
    const p = plan();
    delete p.origin;
    delete p.legModes;
    p.candidates = ['market'];
    p.days = [
      { stops: [{ place: 'tofu' }, { place: 'beach', stayMin: 0 }] },
      { lodging: null, stops: [{ place: 'hotel', stayMin: null, fixedTime: null, note: '' }] },
    ];
    const built = buildLibrary(p, resolved(p), NOW, []);
    const trip = built.lib.trips[built.tripId]!;
    expect(safeParse(LibrarySchema, built.lib).success).toBe(true);
    expect(trip.origin.value).toBeNull();
    expect(trip.candidates.value).toEqual([built.placeIds.get('market')]);
    expect(trip.days[0]!.startTime.value).toBe('09:00');
    expect(trip.days[0]!.lodging.value).toBeNull();
    expect(trip.days[0]!.stops.value.map((stop) => stop.stayMin)).toEqual([null, 0]);
    expect(trip.days[1]!.stops.value[0]).toMatchObject({
      stayMin: null,
      fixedTime: null,
      note: '',
    });
  });

  it('31일 여행의 연산 오류는 endDate 입력 오류다', () => {
    const p = plan();
    p.endDate = '2026-12-20';
    expect(failure(p)).toMatchObject({
      exit: EXIT.input,
      issues: [{ path: 'endDate', code: 'schema' }],
    });
  });

  it.each(['   ', '가'.repeat(61)])('제목 연산 오류를 title에 붙인다: %s', (title) => {
    const p = plan();
    p.title = title;
    expect(failure(p)).toMatchObject({
      exit: EXIT.input,
      issues: [{ path: 'title', code: 'schema' }],
    });
  });

  it('없는 Day에 Stop을 넣는 연산 오류는 해당 Stop 경로다', () => {
    const p = plan();
    p.days.push({ stops: [{ place: 'gangnam' }] });
    expect(failure(p)).toMatchObject({
      exit: EXIT.input,
      issues: [{ path: 'days[2].stops[0]', code: 'schema' }],
    });
  });

  it('마지막 보관함 검사 실패는 내부 오류다', () => {
    const p = plan();
    const places = resolved(p);
    places[0]!.candidate.source = { kind: 'naver', sid: '123' };
    places[1]!.candidate.source = { kind: 'naver', sid: '123' };
    expect(failure(p, places)).toMatchObject({
      exit: EXIT.internal,
      issues: [expect.objectContaining({ code: 'internal' })],
    });
  });

  it('쓰지 않는 장소는 원래 places 인덱스로 경고를 덧붙인다', () => {
    const p = plan();
    p.places.push({ key: 'unused', name: '미사용 장소', lng: 128, lat: 37 });
    const previous: TripIssue = { path: 'places[0]', code: 'lookup-failed', message: '기존 경고' };
    const warnings = [previous];
    const built = buildLibrary(p, resolved(p).reverse(), NOW, warnings);
    expect(safeParse(LibrarySchema, built.lib).success).toBe(true);
    expect(warnings).toEqual([
      previous,
      { path: 'places[5]', code: 'unused-place', message: '쓰지 않는 장소라 문서에 넣지 않았어요' },
    ]);
  });
});

describe('구간 수단 의미 검사', () => {
  it('출발점·Stop·숙소와 다음 날 전날 숙소를 이웃 순서로 검사한다', () => {
    const p = plan();
    p.legModes = {
      'gangnam>tofu': 'car',
      'tofu>beach': 'walk',
      'beach>hotel': 'car',
      'hotel>market': 'car',
      'market>gangnam': 'car',
    };
    expect(checkLegModes(p, resolved(p))).toEqual([]);
  });

  it('이웃하지 않은 쌍과 역방향 쌍은 leg-modes 오류다', () => {
    const p = plan();
    p.legModes = { 'gangnam>hotel': 'car', 'beach>tofu': 'walk' };
    expect(checkLegModes(p, resolved(p))).toEqual([
      expect.objectContaining({ path: 'legModes["gangnam>hotel"]', code: 'leg-modes' }),
      expect.objectContaining({ path: 'legModes["beach>tofu"]', code: 'leg-modes' }),
    ]);
    expect(failure(p)).toMatchObject({ exit: EXIT.input, issues: checkLegModes(p, resolved(p)) });
  });

  it('60km 떨어진 핀의 도보 지정을 조용히 무시하지 않고 거절한다', () => {
    const p = plan();
    const places = resolved(p);
    places[1]!.candidate.lng = 128;
    places[1]!.candidate.lat = 37;
    places[3]!.candidate.lng = 128;
    places[3]!.candidate.lat = 37.54;
    expect(checkLegModes(p, places)).toEqual([
      expect.objectContaining({ path: 'legModes["tofu>beach"]', code: 'walk-too-far' }),
    ]);
    expect(failure(p, places)).toMatchObject({
      exit: EXIT.input,
      issues: checkLegModes(p, places),
    });
  });

  it('출발점과 숙소가 없으면 Stop 사이만 실제 구간이다', () => {
    const p = plan();
    delete p.origin;
    delete p.days[0]!.lodging;
    p.legModes = { 'tofu>beach': 'car', 'hotel>market': 'car' };
    expect(checkLegModes(p, resolved(p))).toEqual([
      expect.objectContaining({ path: 'legModes["hotel>market"]', code: 'leg-modes' }),
    ]);
  });
});
