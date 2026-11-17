// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildCollabDoc } from 'src/domain/trip-collab/build-doc';
import { planFromDoc } from 'src/domain/trip-collab/plan';
import { ESTIMATE_ONLY } from 'src/domain/trip-live/build-live-doc';
import { parseLiveDoc } from 'src/domain/trip-live/live-doc';
import { dayPoints } from 'src/domain/share/check-share-trip';
import { buildLiveLibrary } from '../../../fixtures/builders';
import { buildLiveDoc } from '../../../fixtures/live-trip';
const make = () => {
  const previous = buildLiveDoc();
  return {
    plan: planFromDoc(previous),
    previous,
    lib: buildLiveLibrary(),
    placeMap: { place00001: 'place00001', place00002: 'place00002' },
    role: 'editor' as const,
    options: { includeMemo: true, includeCandidates: false },
    createdAt: previous.share.createdAt,
    routeOf: vi.fn(() => ({ mode: 'car' as const, time: ESTIMATE_ONLY({} as never) })),
  };
};
describe('공동본 만들기', () => {
  it('이전 공동본의 장소 이름·라벨을 유지한다', () => {
    const input = make();
    input.previous.share.places[0]!.name = '공동 이름';
    input.previous.share.labels = [{ id: 'label00001', name: '공동 라벨', color: 'red', order: 0 }];
    input.previous.share.places[0]!.labelIds = ['label00001'];
    const result = buildCollabDoc(input)!;
    expect(result.share.places[0]!.name).toBe('공동 이름');
    expect(result.share.places[0]!.labelIds).toEqual(['label00001']);
    expect(result.share.labels).toEqual(input.previous.share.labels);
  });
  it('편집 기기의 새 장소는 메모·한 줄 평을 싣지 않고 소유자의 새 장소만 옵션을 따른다', () => {
    const input = { ...make(), previous: null };
    const editor = buildCollabDoc(input)!;
    expect(editor.share.places[0]).not.toHaveProperty('memo');
    expect(editor.share.places[0]).not.toHaveProperty('review');
    const owner = buildCollabDoc({ ...input, role: 'owner' })!;
    expect(owner.share.places[0]!.memo).toBe('시험 메모');
  });
  it('구간은 서버 id로 dayPoints 이웃 쌍을 조회하고 v2로 검사된다', () => {
    const input = make();
    input.plan.origin = 'place00002';
    input.plan.days[0]!.lodging = 'place00002';
    const result = buildCollabDoc(input)!;
    result.share.trips[0]!.days.forEach((day, i) =>
      expect(day.legs).toHaveLength(Math.max(0, dayPoints(result.share.trips[0]!, i).length - 1)),
    );
    expect(input.routeOf.mock.calls).toEqual([
      ['place00002', 'place00001'],
      ['place00001', 'place00002'],
      ['place00002', 'place00002'],
    ]);
    expect(result.v).toBe(2);
    expect(result.options.includeCandidates).toBe(true);
    expect(parseLiveDoc(result)).toEqual(result);
  });
  it('지운 장소의 Stop도 문서에 남긴다', () => {
    const input = make();
    const lib = {
      ...input.lib,
      places: {
        ...input.lib.places,
        place00001: { ...input.lib.places.place00001!, deletedAt: '2026-11-01T00:00:00Z' },
      },
    };
    const result = buildCollabDoc({ ...input, lib })!;
    expect(result.ids.stops).toEqual(input.previous.ids.stops);
    expect(result.share.places.map((p) => p.id)).toContain('place00001');
  });
  it('장소가 없으면 null이다', () => {
    const input = make();
    input.plan.days.forEach((d) => {
      d.stops = [];
    });
    expect(buildCollabDoc(input)).toBeNull();
  });
});

it('병합 계획의 대중교통·분을 우선하여 경로 조회 없이 v3를 만든다', () => {
  const input = make();
  input.plan.origin = 'place00002';
  input.plan.legModes['place00002>place00001'] = 'transit';
  input.plan.legMinutes = { 'place00002>place00001': 30 };
  const doc = buildCollabDoc(input)!;
  expect(doc.share.version).toBe(3);
  expect(doc.share.trips[0]!.days[0]!.legs[0]).toMatchObject({
    mode: 'transit',
    status: 'manual',
    durationS: 1800,
  });
  expect(input.routeOf.mock.calls).not.toContainEqual(['place00002', 'place00001']);
  expect(planFromDoc(doc).legMinutes).toEqual(input.plan.legMinutes);
});

it('선택된 자동차 수단에 옛 대중교통 콜백의 시간과 수단을 붙이지 않는다', () => {
  const input = make();
  input.plan.origin = 'place00002';
  input.plan.legModes['place00002>place00001'] = 'car';
  const result = buildCollabDoc({
    ...input,
    routeOf: () => ({
      mode: 'transit',
      time: {
        status: 'estimated',
        durationS: 99999,
        distanceM: 5,
        tollFare: null,
        queriedAt: null,
        path: [],
      },
    }),
  })!;
  expect(result.share.trips[0]!.days[0]!.legs[0]!.mode).toBe('car');
  expect(result.share.trips[0]!.days[0]!.legs[0]!.durationS).not.toBe(99999);
});

it('제외된 장소의 마지막 분은 빈 필드 없이 v2로 만든다', () => {
  const input = make();
  input.plan.legMinutes = { 'removed000>place00001': 30 };
  const result = buildCollabDoc(input)!;
  expect(result.share.version).toBe(2);
  expect(result.share.trips[0]).not.toHaveProperty('legMinutes');
});
it('문서에 있지만 이웃하지 않은 구간의 대중교통·분은 빼고 v2로 만든다', () => {
  const input = make();
  input.plan.origin = 'place00002';
  // 이웃 구간은 place00002>place00001이다. 뒤집은 키는 쓰이지 않는 옛 키다.
  input.plan.legModes['place00001>place00002'] = 'transit';
  input.plan.legMinutes = { 'place00001>place00002': 30 };
  const result = buildCollabDoc(input)!;
  expect(result.share.version).toBe(2);
  expect(result.share.trips[0]).not.toHaveProperty('legMinutes');
  expect(Object.values(result.share.trips[0]!.legModes)).not.toContain('transit');
});
it('분 지움 뒤 콜백의 옛 직접 입력 시간을 다시 쓰지 않는다', () => {
  const input = make();
  input.plan.origin = 'place00002';
  const result = buildCollabDoc({
    ...input,
    routeOf: () => ({
      mode: 'car',
      time: {
        status: 'manual',
        durationS: 99999,
        distanceM: 5,
        tollFare: null,
        queriedAt: null,
        path: [],
      },
    }),
  })!;
  expect(result.share.version).toBe(2);
  expect(result.share.trips[0]!.days[0]!.legs[0]!.status).toBe('estimated');
});

it('수단 지움은 옛 자동차 콜백 대신 가까운 구간의 자동 도보를 쓴다', () => {
  const input = make();
  input.plan.origin = 'place00002';
  input.previous.share.places[1]!.lng = input.previous.share.places[0]!.lng + 0.001;
  input.previous.share.places[1]!.lat = input.previous.share.places[0]!.lat;
  const doc = buildCollabDoc(input)!;
  expect(doc.share.trips[0]!.days[0]!.legs[0]!.mode).toBe('walk');
});
