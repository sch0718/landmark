// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXIT, TripFailure, type TripIssue } from '../../../../pipeline/agent-trip/errors';
import {
  parsePlan,
  type PlanPlace,
  type TripPlan,
} from '../../../../pipeline/agent-trip/plan-schema';
import { resolvePlaces, type ResolveDeps } from '../../../../pipeline/agent-trip/resolve-places';

const summaryUrl = (sid = '20307427') => `https://map.naver.com/p/api/place/summary/${sid}`;
const searchUrl = (q = '카페', near: [number, number] = [126.9784, 37.5666]) =>
  `https://map.naver.com/p/api/search/instant-search?${new URLSearchParams({
    query: q,
    coords: [near[1], near[0]].map((n) => n.toFixed(5)).join(','),
  })}`;
const fallback = { name: '예비 장소', address: '예비 주소', lng: 127, lat: 37 };
const summary = (name = '조회 장소', lng = 127, lat = 37, address = '조회 주소') => ({
  data: {
    placeDetail: {
      name,
      address: { roadAddress: address },
      coordinate: { longitude: lng, latitude: lat },
      category: { category: '카페' },
    },
  },
});
const searchItem = (id: string | null, title = '카페') => ({
  id,
  title,
  x: '127',
  y: '37',
  roadAddress: '조회 주소',
  ctg: '카페',
});
const googleLink = (id: string | null = '0x1:0x2', lat = 37, lng = 127) =>
  `https://www.google.com/maps/place/조회장소/@${lat},${lng},17z/data=${id === null ? '' : `!1s${id}`}`;

function plan(places: PlanPlace[]): TripPlan {
  return {
    format: 'landmark-trip-plan',
    version: 1,
    title: '여행',
    startDate: '2026-11-20',
    endDate: '2026-11-20',
    places,
    days: [{ stops: places.map((p) => ({ place: p.key })) }],
  };
}

type FakeResponse = { body?: unknown; status?: number; location?: string };
function makeDeps(responses: Record<string, FakeResponse> = {}, gapMs?: number) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    const response = responses[url];
    if (!response) throw new Error(`가짜 응답 없음: ${url}`);
    const { body = null, status = 200, location } = response;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: location === undefined ? {} : { Location: location },
    });
  });
  const sleep = vi.fn<ResolveDeps['sleep']>(async () => {});
  const deps: ResolveDeps = { fetch, sleep, ...(gapMs === undefined ? {} : { gapMs }) };
  return { deps, fetch, sleep };
}

async function failure(p: TripPlan, deps: ResolveDeps): Promise<TripFailure> {
  try {
    await resolvePlaces(p, deps, []);
  } catch (error) {
    expect(error).toBeInstanceOf(TripFailure);
    return error as TripFailure;
  }
  throw new Error('장소 조회가 실패해야 해요');
}

afterEach(() => vi.useRealTimers());

describe('계획 장소 조회', () => {
  it('sid를 조회하고 조회 값·계획 key·index·memo를 보존한다', async () => {
    const { deps, fetch } = makeDeps({
      [summaryUrl()]: {
        body: readFileSync('tests/fixtures/naver/place-summary-20307427.json', 'utf8'),
      },
    });
    const warnings: TripIssue[] = [];
    const result = await resolvePlaces(
      plan([{ key: 'abalone', naverSid: '20307427', ...fallback, memo: '저장 메모' }]),
      deps,
      warnings,
    );
    expect(result).toEqual([
      {
        key: 'abalone',
        index: 0,
        memo: '저장 메모',
        candidate: {
          source: { kind: 'naver', sid: '20307427' },
          name: '착한전복 제주중문점',
          address: '제주 서귀포시 천제연로 119',
          lng: 126.4181775,
          lat: 33.2545773,
          category: '전복요리',
        },
      },
    ]);
    expect(warnings).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    });
  });

  it.each(['sid', 'link', 'search'] as const)(
    '%s 실패는 대체 값을 쓰고 원래 sid만 보존한다',
    async (kind) => {
      const source =
        kind === 'sid'
          ? { naverSid: '20307427' }
          : kind === 'link'
            ? { link: 'https://naver.me/place' }
            : { search: { q: '카페' } };
      const { deps } = makeDeps();
      const warnings: TripIssue[] = [];
      const result = await resolvePlaces(
        plan([{ key: 'a', ...source, ...fallback }]),
        deps,
        warnings,
      );
      expect(result[0]).toMatchObject({
        memo: '',
        candidate: {
          ...fallback,
          category: null,
          source: kind === 'sid' ? { kind: 'naver', sid: '20307427' } : { kind: 'pin' },
        },
      });
      expect(warnings).toEqual([
        { path: 'places[0]', code: 'lookup-failed', message: expect.any(String) },
      ]);
    },
  );

  it('대체 값 없는 sid 실패는 조회 오류 3이다', async () => {
    const { deps } = makeDeps({ [summaryUrl()]: { status: 500 } });
    const error = await failure(plan([{ key: 'a', naverSid: '20307427' }]), deps);
    expect(error).toMatchObject({
      exit: EXIT.lookup,
      issues: [{ path: 'places[0]', code: 'lookup-failed' }],
    });
  });

  it('네이버 단축 링크의 307 응답을 따라 장소를 조회한다', async () => {
    const { deps, fetch } = makeDeps({
      'https://naver.me/place': {
        status: 307,
        location: 'https://map.naver.com/p/entry/place/20307427',
      },
      [summaryUrl()]: { body: summary() },
    });
    const result = await resolvePlaces(
      plan([{ key: 'a', link: 'https://naver.me/place' }]),
      deps,
      [],
    );
    expect(result[0]!.candidate).toMatchObject({
      source: { kind: 'naver', sid: '20307427' },
      name: '조회 장소',
    });
    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
      'https://naver.me/place',
      summaryUrl(),
    ]);
  });

  it('폴더 링크는 대체 값이 있어도 장소로 쓰지 않는다', async () => {
    const { deps } = makeDeps({
      'https://naver.me/folder': {
        status: 307,
        location: 'https://map.naver.com/p/favorite/sharedPlace/folder/abc123',
      },
    });
    const error = await failure(
      plan([{ key: 'a', link: 'https://naver.me/folder', ...fallback }]),
      deps,
    );
    expect(error).toMatchObject({
      exit: EXIT.lookup,
      issues: [
        { path: 'places[0]', code: 'lookup-failed', message: '폴더 링크는 장소가 아니에요' },
      ],
    });
  });

  it('카카오 링크는 카카오 출처를 쓴다', async () => {
    const { deps } = makeDeps({
      'https://place-api.map.kakao.com/places/panel3/123': {
        body: {
          summary: {
            name: '카카오 장소',
            point: { lon: 127, lat: 37 },
            address: { disp: '카카오 주소' },
            category: { name: '카페' },
          },
        },
      },
    });
    const result = await resolvePlaces(
      plan([{ key: 'a', link: 'https://place.map.kakao.com/123' }]),
      deps,
      [],
    );
    expect(result[0]!.candidate).toEqual({
      source: { kind: 'kakao', kakaoId: '123' },
      name: '카카오 장소',
      lng: 127,
      lat: 37,
      address: '카카오 주소',
      category: '카페',
    });
  });

  it.each([null, '0x1:0x2'])('구글 장소 id %s에 따라 핀 또는 구글 출처를 쓴다', async (id) => {
    const { deps, fetch } = makeDeps();
    const result = await resolvePlaces(plan([{ key: 'a', link: googleLink(id) }]), deps, []);
    expect(result[0]!.candidate.source).toEqual(
      id === null ? { kind: 'pin' } : { kind: 'google', googleId: id },
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([undefined, '가 cafe'])(
    '검색은 NFC·공백·소문자 정규화로 정확한 이름 하나를 고른다: %s',
    async (name) => {
      const q = name === undefined ? '가 cafe' : '검색어';
      const near: [number, number] = [128, 38];
      const { deps } = makeDeps({
        [searchUrl(q, near)]: {
          body: { place: [searchItem('1', '다른 곳'), searchItem('2', '가 CA FE')] },
        },
      });
      const result = await resolvePlaces(
        plan([{ key: 'a', search: { q, near }, ...(name === undefined ? {} : { name }) }]),
        deps,
        [],
      );
      expect(result[0]!.candidate).toMatchObject({
        source: { kind: 'naver', sid: '2' },
        name: '가 CA FE',
        address: '조회 주소',
        category: '카페',
      });
    },
  );

  it('이름이 달라도 검색 결과가 하나면 고른다', async () => {
    const { deps } = makeDeps({
      [searchUrl()]: { body: { place: [searchItem('1', '다른 이름')] } },
    });
    const result = await resolvePlaces(plan([{ key: 'a', search: { q: '카페' } }]), deps, []);
    expect(result[0]!.candidate.source).toEqual({ kind: 'naver', sid: '1' });
  });

  it('sid 없는 검색 결과는 선택과 후보에서 제외한다', async () => {
    const { deps } = makeDeps({
      [searchUrl()]: { body: { place: [searchItem(null), searchItem('1', '다른 이름')] } },
    });
    const result = await resolvePlaces(plan([{ key: 'a', search: { q: '카페' } }]), deps, []);
    expect(result[0]!.candidate.source).toEqual({ kind: 'naver', sid: '1' });
  });

  it.each([false, true])(
    '검색 후보가 여럿이면 대체 값으로 덮지 않고 후보 5곳까지 알린다: %s',
    async (exact) => {
      const { deps } = makeDeps({
        [searchUrl()]: {
          body: {
            place: Array.from({ length: 8 }, (_, i) =>
              searchItem(String(i + 1), exact ? '카페' : `장소${i}`),
            ),
          },
        },
      });
      const error = await failure(
        plan([{ key: 'a', search: { q: '카페' }, ...fallback, name: '카페' }]),
        deps,
      );
      expect(error.exit).toBe(EXIT.lookup);
      expect(error.issues[0]).toMatchObject({ path: 'places[0]', code: 'ambiguous' });
      expect(error.issues[0]!.candidates).toEqual(
        Array.from({ length: 5 }, (_, i) => ({
          naverSid: String(i + 1),
          name: exact ? '카페' : `장소${i}`,
          address: '조회 주소',
          category: '카페',
        })),
      );
    },
  );

  it.each([{ place: [] }, { place: [searchItem(null)] }])(
    '검색 가능 결과가 없고 좌표가 있으면 핀과 경고를 낸다: %j',
    async ({ place }) => {
      const { deps } = makeDeps({ [searchUrl()]: { body: { place } } });
      const warnings: TripIssue[] = [];
      const result = await resolvePlaces(
        plan([{ key: 'a', search: { q: '카페' }, lng: 127, lat: 37 }]),
        deps,
        warnings,
      );
      expect(result[0]!.candidate).toMatchObject({
        source: { kind: 'pin' },
        name: '카페',
        lng: 127,
        lat: 37,
      });
      expect(warnings).toEqual([
        { path: 'places[0]', code: 'not-found', message: expect.any(String) },
      ]);
    },
  );

  it('검색 결과와 좌표가 없으면 not-found다', async () => {
    const { deps } = makeDeps({ [searchUrl()]: { body: { place: [] } } });
    expect(await failure(plan([{ key: 'a', search: { q: '카페' } }]), deps)).toMatchObject({
      exit: EXIT.lookup,
      issues: [{ code: 'not-found', path: 'places[0]' }],
    });
  });

  it.each([true, false])(
    '8초 시간 초과는 대체 값 유무에 따라 경고 또는 오류다: %s',
    async (hasFallback) => {
      vi.useFakeTimers();
      const { deps, fetch } = makeDeps();
      fetch.mockImplementation(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init!.signal!.addEventListener('abort', () => reject(new Error('요청 중단')), {
              once: true,
            });
          }),
      );
      const warnings: TripIssue[] = [];
      const promise = resolvePlaces(
        plan([{ key: 'a', naverSid: '20307427', ...(hasFallback ? fallback : {}) }]),
        deps,
        warnings,
      );
      const settled = promise.then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error }),
      );
      await vi.advanceTimersByTimeAsync(8001);
      const result = await settled;
      if (hasFallback) {
        expect(result.error).toBeUndefined();
        expect(result.value).toMatchObject([
          { candidate: { ...fallback, source: { kind: 'naver', sid: '20307427' } } },
        ]);
      } else
        expect(result.error).toMatchObject({
          exit: EXIT.lookup,
          issues: [{ code: 'lookup-failed' }],
        });
      expect(fetch.mock.calls[0]![1]!.signal!.aborted).toBe(true);
      expect(warnings).toHaveLength(hasFallback ? 1 : 0);
      if (hasFallback) expect(warnings[0]!.code).toBe('lookup-failed');
    },
  );

  it.each([
    [123.99, 37],
    [132.01, 37],
    [127, 32.99],
    [127, 39.01],
  ])('구글 좌표 %s,%s가 범위 밖이면 대체 값이 있어도 입력 오류다', async (lng, lat) => {
    const { deps } = makeDeps();
    expect(
      await failure(plan([{ key: 'a', link: googleLink(null, lat, lng), ...fallback }]), deps),
    ).toMatchObject({ exit: EXIT.input, issues: [{ code: 'out-of-range', path: 'places[0]' }] });
  });

  it('sid 조회 좌표도 범위를 검사한다', async () => {
    const { deps } = makeDeps({ [summaryUrl()]: { body: summary('범위 밖', 140, 37) } });
    expect(
      await failure(plan([{ key: 'a', naverSid: '20307427', ...fallback }]), deps),
    ).toMatchObject({ exit: EXIT.input, issues: [{ code: 'out-of-range' }] });
  });

  it('구글 id 65자는 링크 경로의 입력 오류다', async () => {
    const { deps } = makeDeps();
    const googleId = `0x${'a'.repeat(30)}:0x${'b'.repeat(30)}`;
    expect(googleId).toHaveLength(65);
    expect(
      await failure(plan([{ key: 'a', link: googleLink(googleId), ...fallback }]), deps),
    ).toMatchObject({
      exit: EXIT.input,
      issues: [{ path: 'places[0].link', code: 'out-of-range' }],
    });
  });

  it.each(['naver', 'kakao', 'search'] as const)(
    '%s에서 얻은 숫자 id 21자는 출처 경로의 입력 오류다',
    async (kind) => {
      const id = '1'.repeat(21);
      const place =
        kind === 'search'
          ? { search: { q: '카페' } }
          : {
              link:
                kind === 'naver'
                  ? `https://map.naver.com/p/entry/place/${id}`
                  : `https://place.map.kakao.com/${id}`,
            };
      const { deps } = makeDeps({
        [summaryUrl(id)]: { body: summary() },
        [searchUrl()]: { body: { place: [searchItem(id)] } },
        [`https://place-api.map.kakao.com/places/panel3/${id}`]: {
          body: { summary: { name: '장소', point: { lon: 127, lat: 37 } } },
        },
      });
      expect(await failure(plan([{ key: 'a', ...place }]), deps)).toMatchObject({
        exit: EXIT.input,
        issues: [
          { path: `places[0].${kind === 'search' ? 'search' : 'link'}`, code: 'out-of-range' },
        ],
      });
    },
  );

  it.each([true, false])('조회 이름이 비면 대체 이름을 쓰거나 조회 실패다: %s', async (hasName) => {
    const { deps } = makeDeps({ [summaryUrl()]: { body: summary('') } });
    const p = plan([{ key: 'a', naverSid: '20307427', ...(hasName ? { name: '대체 이름' } : {}) }]);
    if (hasName) expect((await resolvePlaces(p, deps, []))[0]!.candidate.name).toBe('대체 이름');
    else
      expect(await failure(p, deps)).toMatchObject({
        exit: EXIT.lookup,
        issues: [{ code: 'lookup-failed' }],
      });
  });

  it('긴 이름·주소는 100·200자로 자르고 각각 경고한다', async () => {
    const { deps } = makeDeps({
      [summaryUrl()]: { body: summary('가'.repeat(101), 127, 37, '나'.repeat(201)) },
    });
    const warnings: TripIssue[] = [];
    const result = await resolvePlaces(plan([{ key: 'a', naverSid: '20307427' }]), deps, warnings);
    expect(result[0]!.candidate).toMatchObject({
      name: '가'.repeat(100),
      address: '나'.repeat(200),
    });
    expect(warnings).toHaveLength(2);
    expect(warnings.every((w) => w.code === 'out-of-range' && w.path === 'places[0]')).toBe(true);
  });

  it('sid와 검색이 같은 출처면 뒤 장소 오류에 앞 장소 경로를 알린다', async () => {
    const { deps } = makeDeps({
      [summaryUrl()]: { body: summary() },
      [searchUrl()]: { body: { place: [searchItem('20307427')] } },
    });
    const error = await failure(
      plan([
        { key: 'a', naverSid: '20307427' },
        { key: 'b', search: { q: '카페' } },
      ]),
      deps,
    );
    expect(error).toMatchObject({
      exit: EXIT.input,
      issues: [
        {
          code: 'duplicate-source',
          path: 'places[1]',
          message: expect.stringContaining('places[0]'),
        },
      ],
    });
  });

  it('고정 계획의 서로 다른 핀 5곳은 조회·대기 없이 통과한다', async () => {
    const { deps, fetch, sleep } = makeDeps();
    const p = parsePlan(JSON.parse(readFileSync('tests/fixtures/agent-trip/plan.json', 'utf8')));
    const warnings: TripIssue[] = [];
    const result = await resolvePlaces(p, deps, warnings);
    expect(result).toHaveLength(5);
    expect(result.map((r) => r.candidate.source)).toEqual(
      Array.from({ length: 5 }, () => ({ kind: 'pin' })),
    );
    expect(result.map((r) => r.key)).toEqual(p.places.map((p) => p.key));
    expect(warnings).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([undefined, 25])(
    '핀을 건너뛰고 조회 사이에만 순서대로 sleep을 부른다: %s',
    async (gapMs) => {
      const { deps, fetch, sleep } = makeDeps(
        {
          [summaryUrl('1')]: { body: summary() },
          [summaryUrl('2')]: { body: summary() },
          [summaryUrl('3')]: { body: summary() },
        },
        gapMs,
      );
      await resolvePlaces(
        plan([
          { key: 'a', naverSid: '1' },
          { key: 'pin', ...fallback },
          { key: 'b', naverSid: '2' },
          { key: 'c', naverSid: '3' },
        ]),
        deps,
        [],
      );
      expect(sleep.mock.calls).toEqual([[gapMs ?? 300], [gapMs ?? 300]]);
      expect(fetch.mock.invocationCallOrder[0]!).toBeLessThan(sleep.mock.invocationCallOrder[0]!);
      expect(sleep.mock.invocationCallOrder[0]!).toBeLessThan(fetch.mock.invocationCallOrder[1]!);
      expect(fetch.mock.invocationCallOrder[1]!).toBeLessThan(sleep.mock.invocationCallOrder[1]!);
      expect(sleep.mock.invocationCallOrder[1]!).toBeLessThan(fetch.mock.invocationCallOrder[2]!);
    },
  );

  it('조회를 끝까지 하고 모든 오류를 모으며 입력 오류를 우선한다', async () => {
    const { deps, fetch } = makeDeps({
      [summaryUrl('1')]: { status: 500 },
      [summaryUrl('2')]: { status: 500 },
    });
    const error = await failure(
      plan([
        { key: 'a', naverSid: '1' },
        { key: 'b', link: googleLink(null, 40) },
        { key: 'c', naverSid: '2' },
      ]),
      deps,
    );
    expect(error.exit).toBe(EXIT.input);
    expect(error.issues.map(({ path, code }) => ({ path, code }))).toEqual([
      { path: 'places[0]', code: 'lookup-failed' },
      { path: 'places[1]', code: 'out-of-range' },
      { path: 'places[2]', code: 'lookup-failed' },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
