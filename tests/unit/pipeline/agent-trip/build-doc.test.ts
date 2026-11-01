// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { defaultTitleLabel } from 'src/domain/library/import-share';
import { importSharedTrip } from 'src/domain/library/import-share-trip';
import { ITEM_DOC_MAX_CHARS, stableStringify } from 'src/domain/library-sync/items';
import { AGENT_INBOX_LIMITS } from 'src/domain/share/agent-limits';
import { buildTripShareDoc, type ShareLegTime } from 'src/domain/share/build-trip-share';
import { checkShareTrip } from 'src/domain/share/check-share-trip';
import { readShareHash } from 'src/domain/share/read-share';
import { emptyLibrary, type Label, type Library } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { ShareDocV2Schema, type ShareDocV2 } from 'src/schema/share';
import { encodeShareHash, hashDoc } from 'src/share-viewer/encode';
import { buildDoc, oversizedItems } from '../../../../pipeline/agent-trip/build-doc';
import { buildLibrary } from '../../../../pipeline/agent-trip/build-library';
import { EXIT, TripFailure, type TripIssue } from '../../../../pipeline/agent-trip/errors';
import { parsePlan, type TripPlan } from '../../../../pipeline/agent-trip/plan-schema';
import type { ResolvedPlace } from '../../../../pipeline/agent-trip/resolve-places';
import { prepareRoutes } from '../../../../pipeline/agent-trip/route-legs';

const NOW = new Date('2026-11-01T05:12:00.000Z');
const APP = 'https://landmark.sch0718.dev';
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
const options = (p: TripPlan, includeMemo = false) => ({
  title: p.title,
  includeMemo,
  app: APP,
  now: NOW,
});
async function setup(p: TripPlan) {
  const warnings: TripIssue[] = [];
  const built = buildLibrary(p, resolved(p), NOW, warnings);
  const fetch = vi.fn<typeof globalThis.fetch>(() => {
    throw new Error('실제 요청을 보내면 안 돼요');
  });
  const { routeOf } = await prepareRoutes(built, { fetch, sleep: vi.fn(), skip: true }, warnings);
  expect(fetch).not.toHaveBeenCalled();
  return { built, routeOf, warnings };
}
async function failure(work: Promise<unknown>): Promise<TripFailure> {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(TripFailure);
    return error as TripFailure;
  }
  throw new Error('공유 문서 오류가 나야 해요');
}
function largePlan(): TripPlan {
  return parsePlan({
    format: 'landmark-trip-plan',
    version: 1,
    title: '장소 200곳',
    startDate: '2026-11-20',
    endDate: '2026-11-21',
    places: Array.from({ length: 200 }, (_, i) => ({
      key: `p${i}`,
      name: `${i}`.padEnd(100, '가'),
      address: '나'.repeat(200),
      lng: 127 + i * 0.001,
      lat: 37,
    })),
    days: [0, 1].map((d) => ({
      stops: Array.from({ length: 100 }, (_, i) => ({ place: `p${d * 100 + i}` })),
    })),
  });
}
function randomValues() {
  let seed = 123456789;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

describe('앱과 같은 공유 문서·가져오기·링크', () => {
  it('고정 계획이 스키마·관계 검사를 통과하고 가져오기 해시가 같은 문서로 풀린다', async () => {
    const p = plan();
    const { built, routeOf } = await setup(p);
    const before = structuredClone(built.lib);
    const result = await buildDoc(built, routeOf, options(p), p);
    expect(safeParse(ShareDocV2Schema, result.doc, { onExcessProperty: 'error' }).success).toBe(
      true,
    );
    expect(checkShareTrip(result.doc)).toEqual([]);
    expect(await readShareHash(result.importHash, AGENT_INBOX_LIMITS)).toEqual({
      ok: true,
      doc: hashDoc(result.doc),
    });
    expect(result.view).toBe(`${APP}/view#d=${result.viewHash}`);
    expect(result.importHref).toBe(`${APP}/import#d=${result.importHash}`);
    expect(built.lib).toEqual(before);
  });

  it('장소 메모를 빼도 Stop note는 남고 메모 포함 옵션을 켜면 장소 메모도 남는다', async () => {
    const p = plan();
    const { built, routeOf } = await setup(p);
    const without = await buildDoc(built, routeOf, options(p), p);
    expect(without.doc.places.every((place) => !Object.hasOwn(place, 'memo'))).toBe(true);
    expect(without.doc.trips[0]!.days[0]!.stops[0]!.note).toBe('영업시간 확인 필요');
    const withMemo = await buildDoc(built, routeOf, options(p, true), p);
    expect(withMemo.doc.places.find((place) => place.id === built.placeIds.get('tofu'))?.memo).toBe(
      '점심 대기 시간 확인',
    );
  });

  it.each([30, 31, 60])('제목 %i자를 제목 라벨 한도에 맞춰 모의 가져오기 한다', async (length) => {
    const p = plan();
    p.title = '가'.repeat(length);
    const { built, routeOf } = await setup(p);
    expect((await buildDoc(built, routeOf, options(p), p)).doc.title).toBe(p.title);
  });

  it.each(['stop', 'candidate'] as const)(
    '20m 떨어진 같은 이름 핀이 %s에서 사라지면 두 계획 경로를 알린다',
    async (kind) => {
      const p = plan();
      p.origin = null;
      p.legModes = {};
      p.places = [
        { key: 'a', name: '같은 핀', lng: 127, lat: 37 },
        { key: 'b', name: '같은 핀', lng: 127, lat: 37.00018 },
      ];
      p.days = [{ stops: [{ place: 'a' }] }, { stops: kind === 'stop' ? [{ place: 'b' }] : [] }];
      p.candidates = kind === 'candidate' ? ['b'] : [];
      const { built, routeOf } = await setup(p);
      const error = await failure(buildDoc(built, routeOf, options(p), p));
      expect(error.exit).toBe(EXIT.input);
      expect(error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'merged-places', path: 'days[0].stops[0].place' }),
          expect.objectContaining({
            code: 'merged-places',
            path: kind === 'stop' ? 'days[1].stops[0].place' : 'candidates[0]',
          }),
        ]),
      );
    },
  );

  it('이름 100자·주소 200자인 장소 200곳은 메모 없이 동기화 상한 안에서 성공한다', async () => {
    const p = largePlan();
    const { built, routeOf } = await setup(p);
    const result = await buildDoc(built, routeOf, options(p), p);
    expect(result.doc.places).toHaveLength(200);
    expect(oversizedItems(built.lib, ITEM_DOC_MAX_CHARS)).toEqual([]);
    const imported = importSharedTrip(
      emptyLibrary(),
      hashDoc(result.doc) as ShareDocV2,
      {
        titleLabel: defaultTitleLabel(result.doc.title),
        appendMemo: true,
      },
      {
        now: NOW.toISOString(),
        newId: (() => {
          let id = 0;
          return (kind) => String(++id).padStart(kind === 'label' || kind === 'stop' ? 8 : 10, '0');
        })(),
      },
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw new Error('모의 가져오기가 성공해야 해요');
    expect(oversizedItems(imported.lib, ITEM_DOC_MAX_CHARS)).toEqual([]);
  }, 30_000);

  it('장소 200곳의 10,000자 메모는 압축 해제 1MB 상한을 넘어 too-big이다', async () => {
    const p = largePlan();
    p.places.forEach((place) => {
      // 보기 링크의 5MB 상한은 넘지 않게 해, 받은함의 압축 해제 1MB 상한을 따로 검증한다.
      place.memo = 'a'.repeat(10_000);
    });
    const { built, routeOf } = await setup(p);
    const doc = buildTripShareDoc(built.lib, built.tripId, routeOf, {
      ...options(p, true),
      includeCandidates: true,
    })!;
    expect(new TextEncoder().encode(JSON.stringify(hashDoc(doc))).byteLength).toBeGreaterThan(
      AGENT_INBOX_LIMITS.decodedBytes,
    );
    expect((await encodeShareHash(hashDoc(doc))).length).toBeLessThanOrEqual(
      AGENT_INBOX_LIMITS.hashChars,
    );
    const error = await failure(buildDoc(built, routeOf, options(p, true), p));
    expect(error.exit).toBe(EXIT.input);
    expect(error.issues).toEqual([
      expect.objectContaining({ code: 'too-big', message: expect.stringContaining('corrupt') }),
    ]);
  }, 30_000);

  it('경로선 때문에 보기 해시가 길어지면 경로선을 뺀 direct 링크를 만든다', async () => {
    const p = largePlan();
    const { built } = await setup(p);
    const random = randomValues();
    const routeOf = (): ShareLegTime => ({
      durationS: 60,
      distanceM: 1000,
      tollFare: null,
      status: 'routed',
      queriedAt: NOW.toISOString(),
      path: Array.from({ length: 200 }, () => [124 + random() * 8, 33 + random() * 6]),
    });
    const result = await buildDoc(built, routeOf, options(p), p);
    expect((await encodeShareHash(result.doc)).length).toBeGreaterThan(32_000);
    expect(result.viewHash).toBe(await encodeShareHash(hashDoc(result.doc)));
    expect(result.importHash).toBe(result.viewHash);
    expect(result.doc.trips[0]!.days[0]!.legs[0]!.path).toHaveLength(200);
  }, 30_000);

  it('경로선을 빼도 압축 해시가 32,000자를 넘으면 too-big이다', async () => {
    const p = largePlan();
    const random = randomValues();
    for (const day of p.days)
      for (const stop of day.stops) {
        stop.note = Array.from({ length: 500 }, () =>
          String.fromCharCode(33 + Math.floor(random() * 90)),
        ).join('');
      }
    const { built, routeOf } = await setup(p);
    const doc = buildTripShareDoc(built.lib, built.tripId, routeOf, {
      ...options(p),
      includeCandidates: true,
    })!;
    expect((await encodeShareHash(hashDoc(doc))).length).toBeGreaterThan(32_000);
    const error = await failure(buildDoc(built, routeOf, options(p), p));
    expect(error.exit).toBe(EXIT.input);
    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'too-big',
        message: expect.stringContaining('장소·Day를 줄이거나 앱에서 파일로 공유해 주세요'),
      }),
    ]);
  }, 30_000);

  it('쓰지 않는 장소를 문서에서 빼고 앞 단계의 경고를 보존한다', async () => {
    const p = plan();
    p.places.push({ key: 'unused', name: '안 쓰는 핀', lng: 127, lat: 37 });
    const { built, routeOf, warnings } = await setup(p);
    const result = await buildDoc(built, routeOf, options(p), p);
    expect(result.doc.places.some((place) => place.id === built.placeIds.get('unused'))).toBe(
      false,
    );
    expect(warnings).toContainEqual(
      expect.objectContaining({ path: 'places[5]', code: 'unused-place' }),
    );
  });

  it('여행이 없으면 내부 오류다', async () => {
    const p = plan();
    const { built, routeOf } = await setup(p);
    const error = await failure(buildDoc({ ...built, tripId: 'missing' }, routeOf, options(p), p));
    expect(error.exit).toBe(EXIT.internal);
    expect(error.issues[0]?.code).toBe('internal');
  });

  it('구간 스키마가 틀리면 내부 오류에 문제 경로를 남긴다', async () => {
    const p = plan();
    const { built, routeOf } = await setup(p);
    const error = await failure(
      buildDoc(built, (leg) => ({ ...routeOf(leg), durationS: NaN }), options(p), p),
    );
    expect(error.exit).toBe(EXIT.internal);
    expect(
      error.issues.some(
        (issue) =>
          issue.code === 'internal' && `${issue.path} ${issue.message}`.includes('durationS'),
      ),
    ).toBe(true);
  });

  it('구간 관계가 틀리면 검사 문제 줄을 내부 오류로 남긴다', async () => {
    const p = plan();
    const { built, routeOf } = await setup(p);
    const error = await failure(
      buildDoc(
        built,
        (leg) => ({ ...routeOf(leg), status: 'routed', queriedAt: null }),
        options(p),
        p,
      ),
    );
    expect(error.exit).toBe(EXIT.internal);
    expect(error.issues[0]).toMatchObject({
      code: 'internal',
      message: expect.stringContaining('조회 시각이 없어요'),
    });
  });

  it('서버와 같은 내용 한도를 벗어나면 내부 오류다', async () => {
    const p = plan();
    const { built, routeOf } = await setup(p);
    const error = await failure(
      buildDoc(built, routeOf, { ...options(p), title: '가'.repeat(61) }, p),
    );
    expect(error.exit).toBe(EXIT.internal);
    expect(error.issues[0]).toMatchObject({
      code: 'internal',
      message: expect.stringContaining('title'),
    });
  });
});

describe('동기화 항목 크기 경계', () => {
  it.each(['place', 'label', 'trip'] as const)(
    '%s는 정확히 max면 통과하고 max+1이면 항목 키를 돌려준다',
    (kind) => {
      const p = plan();
      const { lib, tripId, placeIds } = buildLibrary(p, resolved(p), NOW, []);
      const id = kind === 'place' ? placeIds.get('tofu')! : kind === 'trip' ? tripId : 'label001';
      const label: Label = {
        id,
        name: { value: '제목', updatedAt: NOW.toISOString() },
        color: { value: 'red', updatedAt: NOW.toISOString() },
        icon: { value: 'landmark', updatedAt: NOW.toISOString() },
        order: { value: 0, updatedAt: NOW.toISOString() },
        createdAt: NOW.toISOString(),
        deletedAt: null,
      };
      const item = kind === 'place' ? lib.places[id]! : kind === 'trip' ? lib.trips[id]! : label;
      const isolated: Library = {
        ...emptyLibrary(),
        places: kind === 'place' ? { [id]: lib.places[id]! } : {},
        labels: kind === 'label' ? { [id]: label } : {},
        trips: kind === 'trip' ? { [id]: lib.trips[id]! } : {},
      };
      const size = stableStringify(item).length;
      expect(oversizedItems(isolated, size)).toEqual([]);
      expect(oversizedItems(isolated, size - 1)).toEqual([`${kind}:${id}`]);
    },
  );
});
