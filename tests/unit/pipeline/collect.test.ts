import { describe, expect, it, vi } from 'vitest';
import { collect, SourceValidationError } from '../../../pipeline/collect';
import { UnresolvedPlacesError } from '../../../pipeline/resolve-stops';
import { validateAll } from '../../../pipeline/validate';
import { parseOrThrow } from 'src/schema/parse';
import { TRIP_DATA_PARSE, TripDataSchema } from 'src/schema/trip-data';
import { fixture, NOW, setupCollect as setup, SHARE_ID, YAML_PATH } from './pipeline-harness';

describe('collect', () => {
  it('id를 yaml에 기록하고(주석 유지) TripData를 만든다', async () => {
    const { fs, deps } = setup();
    const r = await collect(YAML_PATH, { refreshRoutes: false }, deps);

    const yamlOut = fs.files[YAML_PATH]!;
    expect(yamlOut).toContain(`publicId: ${r.publicId}`);
    expect(yamlOut).toContain('# 테스트용 여행 (id 없음)');
    expect(yamlOut).toContain('# 속초, 고성, 양양 맛집');
    expect(yamlOut.match(/id: [a-z0-9]{4,}/g)).toHaveLength(4);

    expect(r.outPath).toBe(`public/data/${r.publicId}.json`);
    const raw = fs.files[r.outPath]!;
    expect(raw).not.toContain('\n');
    const data = parseOrThrow(TripDataSchema, JSON.parse(raw), TRIP_DATA_PARSE);
    expect(data.dataVersion).toBe(NOW);
    expect(data.folders[0]).toMatchObject({ id: 'f1', name: '속초, 고성, 양양 맛집' });
    expect(raw).not.toContain(SHARE_ID);
    expect(data.days[0]!.stops).toHaveLength(3);
    expect(data.days[0]!.legs).toHaveLength(2);
    expect(data.days[1]!.legs).toEqual([]);
    expect(r.summary.days[0]).toMatchObject({ date: '2026-11-14', stops: 3, failed: [] });
    expect(r.summary.days[0]!.roadDistanceM).toBeGreaterThan(0);
    expect(r.summary.folders[0]!.name).toBe('속초, 고성, 양양 맛집');
  });

  it('두 번째 실행은 yaml 바이트가 같고 경로 API를 호출하지 않는다', async () => {
    const { fs, deps, calls } = setup();
    await collect(YAML_PATH, { refreshRoutes: false }, deps);
    const yamlAfterFirst = fs.files[YAML_PATH];
    const routesAfterFirst = calls.route;
    expect(routesAfterFirst).toBeGreaterThan(0);

    await collect(YAML_PATH, { refreshRoutes: false }, deps);
    expect(fs.files[YAML_PATH]).toBe(yamlAfterFirst);
    expect(calls.route).toBe(routesAfterFirst);
  });

  it('빈 일정(마지막 stop 삭제)도 통과한다', async () => {
    const yaml = fixture('trips/basic.yaml').replace(
      /stops:\n {6}- \{ place: '1732759357' \}\n/,
      'stops: []\n',
    );
    expect(yaml).not.toContain('1732759357');
    const { fs, deps } = setup(yaml);
    const r = await collect(YAML_PATH, { refreshRoutes: false }, deps);
    const data = parseOrThrow(TripDataSchema, JSON.parse(fs.files[r.outPath]!), TRIP_DATA_PARSE);
    expect(data.days[1]).toMatchObject({ stops: [], legs: [] });
  });

  it('없는 sid는 UnresolvedPlacesError이고 JSON을 만들지 않는다', async () => {
    const yaml = fixture('trips/basic.yaml').replace('1732759357', '999');
    const { fs, deps } = setup(yaml);
    const err = await collect(YAML_PATH, { refreshRoutes: false }, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnresolvedPlacesError);
    expect((err as UnresolvedPlacesError).places).toEqual([{ date: '2026-11-15', place: '999' }]);
    expect(Object.keys(fs.files).filter((p) => p.startsWith('public/'))).toEqual([]);
  });

  it('폴더를 가져오지 못하면 shareId를 담아 실패하고 JSON을 만들지 않는다', async () => {
    const { fs, deps } = setup(undefined, 500);
    await expect(collect(YAML_PATH, { refreshRoutes: false }, deps)).rejects.toThrow(SHARE_ID);
    expect(Object.keys(fs.files).filter((p) => p.startsWith('public/'))).toEqual([]);
  });

  it('잘못된 id는 덮어쓰지 않고 검증 오류로 실패한다', async () => {
    const yaml = fixture('trips/basic.yaml').replace(
      '{ place: start }',
      '{ id: BAD, place: start }',
    );
    const { fs, deps } = setup(yaml);
    await expect(collect(YAML_PATH, { refreshRoutes: false }, deps)).rejects.toBeInstanceOf(
      SourceValidationError,
    );
    expect(fs.files[YAML_PATH]).toBe(yaml);
  });

  it('경로 하나가 실패하면 합계에서 제외하고 미계산으로 센다', async () => {
    const { fs, deps } = setup(undefined, 200, 2);
    const r = await collect(YAML_PATH, { refreshRoutes: false }, deps);
    const day = r.summary.days[0]!;
    expect(day.uncomputedCount).toBe(1);
    expect(day.straightDistanceM).toBeGreaterThan(0);
    expect(day.failed).toHaveLength(1);
    const data = parseOrThrow(TripDataSchema, JSON.parse(fs.files[r.outPath]!), TRIP_DATA_PARSE);
    const [routed, failedLeg] = data.days[0]!.legs;
    expect(failedLeg!.status).toBe('failed');
    expect(day.roadDistanceM).toBe(routed!.distanceM);
    expect(day.durationMs).toBe(routed!.durationMs);
    expect(day.tollFare).toBe(routed!.tollFare);
    const lines = vi.mocked(deps.log).mock.calls.map((c) => c[0]);
    expect(lines.some((l) => l.includes('미계산 1구간'))).toBe(true);
  });

  it('collect 결과는 validateAll을 통과한다', async () => {
    const { fs, deps } = setup();
    await collect(YAML_PATH, { refreshRoutes: false }, deps);
    expect(await validateAll({ fs })).toEqual({ ok: true, errors: [] });
  });

  describe('naverPlaces', () => {
    const yaml = (ids: string) => `title: 제주
startDate: 2026-09-20
endDate: 2026-09-20
folders: []
naverPlaces: [${ids}]
customPlaces:
  - { key: airport, name: 제주국제공항, lng: 126.4916441, lat: 33.5070711 }
days:
  - date: 2026-09-20
    stops:
      - { place: airport }
      - { place: '20307427', note: 저녁 }
`;

    it('저장 폴더 없이 장소 ID로 네이버 분류·링크가 있는 장소를 만든다', async () => {
      const { fs, deps, calls } = setup(yaml("'20307427'"));
      const r = await collect(YAML_PATH, { refreshRoutes: false }, deps);
      const data = parseOrThrow(TripDataSchema, JSON.parse(fs.files[r.outPath]!), TRIP_DATA_PARSE);
      expect(calls.placeSids).toEqual(['20307427']);
      expect(data.places['n:20307427']).toMatchObject({
        name: '착한전복 제주중문점',
        category: '전복요리',
        sid: '20307427',
        folderIds: [],
      });
      expect(data.days[0]?.stops.map((st) => st.placeKey)).toEqual(['c:airport', 'n:20307427']);
    });

    it('장소 ID를 가져오지 못하면 그 ID를 담아 실패하고 JSON을 만들지 않는다', async () => {
      const { fs, deps } = setup(yaml("'20307427', '999'"));
      await expect(collect(YAML_PATH, { refreshRoutes: false }, deps)).rejects.toThrow(/999/);
      expect(Object.keys(fs.files).filter((f) => f.startsWith('public/'))).toEqual([]);
    });
  });
});
