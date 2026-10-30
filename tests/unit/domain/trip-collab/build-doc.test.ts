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
