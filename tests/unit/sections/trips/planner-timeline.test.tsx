import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Layer } from 'effect';
import { Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { RouteLookup } from 'src/services/route-lookup';
import { useDayPlan } from 'src/sections/trips/planner/use-day-plan';
import { libraryAtom } from 'src/stores/library-state';
import { selectedDayAtom } from 'src/stores/trip-planner';
import { T0 } from '../library/fixtures';
import {
  fakeRoutes,
  GONE,
  HOUSE,
  legRow,
  makeTrip,
  open,
  P1,
  P2,
  P3,
  P5,
  plannerLibrary,
  route,
  stopRow,
  timeline,
  TRIP,
  withTrip,
} from './planner-fixtures';

const toastMock = vi.hoisted(() => {
  const error = vi.fn();
  return Object.assign(vi.fn(), { error });
});
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 13, 12, 0, 0));
});
afterEach(() => {
  toastMock.mockClear();
  toastMock.error.mockClear();
  setAppRuntimeForTest(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type ToastOptions = { duration?: number; action?: { label: string; onClick(): void } };

/** `message`로 띄운 마지막 토스트의 옵션. */
function lastToast(message: string): ToastOptions {
  const call = toastMock.mock.calls.findLast((c) => c[0] === message);
  expect(call, `토스트 '${message}'`).toBeDefined();
  return (call![1] ?? {}) as ToastOptions;
}

/** `message` 토스트의 `되돌리기`를 누른다. */
async function undoLast(message: string) {
  const options = lastToast(message);
  expect(options.action?.label).toBe('되돌리기');
  await act(async () => {
    options.action!.onClick();
  });
}

// ---------- 테스트 ----------

describe('후보 칸', () => {
  it('＋를 누르면 지금 Day 끝에 들어가고 시간표에 도착 시각이 보인다', async () => {
    const routes = fakeRoutes(() => route(12, 1100));
    const lib = withTrip(plannerLibrary(), makeTrip({ candidates: [P1, P2] }));
    const { store } = await open(lib, { routes, ids: ['stopaaaa', 'stopbbbb'] });
    const user = userEvent.setup();

    const panel = screen.getByRole('region', { name: '후보 칸' });
    expect(within(panel).getByText('강릉 여행')).toBeInTheDocument();
    expect(within(panel).getByText('후보 2')).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: '중앙시장 닭강정을 Day 1에 넣기' }));
    await waitFor(() =>
      expect(
        store.get(libraryAtom).trips[TRIP]!.days[0]!.stops.value.map((s) => s.placeId),
      ).toEqual([P1]),
    );
    expect(within(stopRow('중앙시장 닭강정')).getByText('09:00')).toBeInTheDocument();
    expect(store.get(libraryAtom).trips[TRIP]!.candidates.value).toEqual([P2]);

    // 받침이 없는 이름은 `를`.
    await user.click(screen.getByRole('button', { name: '안목 카페거리를 Day 1에 넣기' }));
    await waitFor(() =>
      expect(
        store.get(libraryAtom).trips[TRIP]!.days[0]!.stops.value.map((s) => s.placeId),
      ).toEqual([P1, P2]),
    );
    expect(await within(stopRow('안목 카페거리')).findByText('09:12')).toBeInTheDocument();
    expect(within(panel).getByText('후보 0')).toBeInTheDocument();
  });

  it('이름·지역·대표 라벨 색을 보이고, 후보가 있으면 Day 자동 나누기가 켜진다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ candidates: [P3] }));
    await open(lib);
    const panel = screen.getByRole('region', { name: '후보 칸' });
    const row = within(panel).getByText('속초 횟집').closest('li')!;
    expect(within(row).getByText('속초')).toBeInTheDocument();
    expect(within(row).getByRole('img', { name: '맛집' })).toBeInTheDocument();
    for (const name of ['보관함에서 더하기', '링크·핀으로 새로 추가']) {
      // 보관함·장소 추가와의 연결은 library-links.test.tsx가 다룬다.
      expect(within(panel).getByRole('button', { name })).toBeEnabled();
    }
    expect(within(panel).getByRole('button', { name: 'Day 자동 나누기' })).toBeEnabled();
  });
});

describe('구간과 경로 상태', () => {
  it('성공·경로 없음·실패(다시 시도)를 구간마다 보인다', async () => {
    const routes = fakeRoutes((call, nth) => {
      if (call.to === '안목 카페거리') return route(12, 1100);
      if (call.to === '속초 횟집') return 'NO_ROUTE';
      return nth === 1 ? 'UPSTREAM_ERROR' : route(20, 2300); // 속초 횟집 → 창가 자리
    });
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P2, P3, P5]] }));
    await open(lib, { routes });
    const user = userEvent.setup();

    const ok = legRow('중앙시장 닭강정', '안목 카페거리');
    expect(await within(ok).findByText('12분 · 1.1km')).toBeInTheDocument();
    expect(within(ok).queryByText('직선 추정')).not.toBeInTheDocument();

    const none = legRow('안목 카페거리', '속초 횟집');
    expect(await within(none).findByText('경로 없음 · 직선 추정')).toBeInTheDocument();

    const failed = legRow('속초 횟집', '창가 자리');
    expect(await within(failed).findByText('경로를 못 가져왔어요')).toBeInTheDocument();
    // 합계는 추정이 섞여 `약`.
    expect(within(timeline()).getByText(/^약 이동 /)).toBeInTheDocument();

    const before = routes.calls.length;
    await user.click(within(failed).getByRole('button', { name: '다시 시도' }));
    expect(await within(failed).findByText('20분 · 2.3km')).toBeInTheDocument();
    expect(routes.calls.length).toBe(before + 1);
    expect(routes.calls.at(-1)).toMatchObject({ to: '창가 자리', refresh: true });
    expect(within(failed).queryByText('경로를 못 가져왔어요')).not.toBeInTheDocument();
  });

  it('구간 행의 `네이버 지도로 길찾기`: 넓은 화면은 웹 길찾기 주소', async () => {
    const routes = fakeRoutes(() => route(12, 1100));
    await open(withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P2]] })), { routes });
    const row = legRow('중앙시장 닭강정', '안목 카페거리');
    const link = within(row).getByRole('link', { name: '네이버 지도로 길찾기' });
    expect(link.getAttribute('href')).toMatch(
      /^https:\/\/map\.naver\.com\/p\/directions\/128\.9,37\.75,.+,,SIMPLE_POI\/128\.947,37\.772,.+,,SIMPLE_POI\/-\/car$/,
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('구간 행의 `네이버 지도로 길찾기`: 좁은 화면은 nmap:// 앱 주소(수단 반영)', async () => {
    const routes = fakeRoutes(() => route(12, 1100));
    // P1 → P5는 약 440m라 자동 도보.
    await open(withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P5]] })), {
      routes,
      width: 375,
    });
    const user = userEvent.setup();
    await user.click(
      within(screen.getByRole('region', { name: '일정 시트' })).getByRole('tab', { name: 'Day 1' }),
    );
    const link = within(legRow('중앙시장 닭강정', '창가 자리')).getByRole('link', {
      name: '네이버 지도로 길찾기',
    });
    const href = link.getAttribute('href')!;
    expect(href).toMatch(/^nmap:\/\/route\/walk\?slat=37\.75&slng=128\.9&sname=/);
    expect(href).toContain('&dlat=37.75&dlng=128.905&dname=');
    expect(href).toContain('&appname=landmark-c5f.pages.dev');
    // 앱 주소는 새 탭으로 열지 않는다.
    expect(link).not.toHaveAttribute('target');
    expect(link).not.toHaveAttribute('rel');
  });

  it('오프라인이면 시간표 위에 한 번 안내하고 구간은 직선 추정', async () => {
    // 기본 하네스: 경로 조회가 늘 OFFLINE.
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P2, P5]] }));
    await open(lib);
    expect(
      await screen.findByText('인터넷에 연결되지 않아 이동 시간은 어림값이에요'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('인터넷에 연결되지 않아 이동 시간은 어림값이에요')).toHaveLength(1);
    expect(
      within(legRow('중앙시장 닭강정', '안목 카페거리')).getByText('직선 추정'),
    ).toBeInTheDocument();
    expect(within(timeline()).queryByText('경로를 못 가져왔어요')).not.toBeInTheDocument();
    expect(within(timeline()).getByText(/^약 이동 /)).toBeInTheDocument();
    expect(within(timeline()).queryByText(/조회$/)).not.toBeInTheDocument();
  });

  it('합계에 이동 시간·거리·통행료와 조회 날짜를 보이고, 다시 계산은 캐시를 건너뛴다', async () => {
    const routes = fakeRoutes((call, nth) =>
      call.to === '안목 카페거리'
        ? route(50, 30_000, {
            toll: 3000,
            queriedAt: nth === 1 ? '2026-10-12T03:00:00.000Z' : '2026-10-13T03:00:00.000Z',
          })
        : route(30, 24_000, { queriedAt: '2026-10-13T01:00:00.000Z' }),
    );
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P2, P3]], legModes: {} }));
    await open(lib, { routes });
    const user = userEvent.setup();

    expect(
      await within(timeline()).findByText('이동 1시간 20분 · 54km · 통행료 3,000원'),
    ).toBeInTheDocument();
    expect(within(timeline()).getByText('10월 12일 조회')).toBeInTheDocument();

    await user.click(within(timeline()).getByRole('button', { name: '다시 계산' }));
    expect(await within(timeline()).findByText('10월 13일 조회')).toBeInTheDocument();
    const refreshed = routes.calls.filter((c) => c.refresh);
    expect(refreshed.map((c) => c.to).sort()).toEqual(['속초 횟집', '안목 카페거리']);
  });

  it('다시 계산이 먼저 끝나고 오래된 처음 응답이 늦게 와도 화면은 새 시간·조회 시각을 지킨다', async () => {
    // 처음 요청(보통, 번호 1)은 늦게 끝나고, 그사이 `다시 계산`(번호 2)이 새 답을 먼저 준다. 조회 계층이
    // 어떤 순서로 답하든(가짜는 캐시로 순서를 맞추지 않는다) 먼저 시작한 요청의 답이 화면을 되돌리면 안 된다.
    const calls: { refresh: boolean }[] = [];
    let releaseStale: () => void = () => {};
    const stale = {
      ...route(20, 5000, { queriedAt: '2026-10-12T03:00:00.000Z' }),
      seq: 1,
      fresh: false,
    };
    const newer = {
      ...route(45, 9000, { queriedAt: '2026-10-13T03:00:00.000Z' }),
      seq: 2,
      fresh: true,
    };
    const layer = Layer.succeed(
      RouteLookup,
      RouteLookup.of({
        leg: (_mode, _from, _to, options) =>
          Effect.suspend(() => {
            const refresh = options?.refresh === true;
            calls.push({ refresh });
            if (refresh) return Effect.succeed(newer);
            return Effect.promise(
              () => new Promise<typeof stale>((resolve) => (releaseStale = () => resolve(stale))),
            );
          }),
      }),
    );
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P2]] }));
    await open(lib, { routes: { layer, calls: [] } });
    const user = userEvent.setup();
    const leg = () => legRow('중앙시장 닭강정', '안목 카페거리');

    await waitFor(() => expect(calls).toHaveLength(1));
    // 처음 응답이 오기 전에도 합계 줄(다시 계산)은 보인다.
    await user.click(within(timeline()).getByRole('button', { name: '다시 계산' }));
    expect(await within(leg()).findByText('45분 · 9km')).toBeInTheDocument();
    expect(within(timeline()).getByText('10월 13일 조회')).toBeInTheDocument();

    await act(async () => {
      releaseStale();
    });
    await act(async () => {});
    expect(within(leg()).getByText('45분 · 9km')).toBeInTheDocument();
    expect(within(timeline()).getByText('10월 13일 조회')).toBeInTheDocument();
    expect(within(timeline()).queryByText('10월 12일 조회')).not.toBeInTheDocument();
  });

  describe('실제 조회 계층으로 본 요청 순서 뒤바뀜', () => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    const errorBody = (code: string, status: number) =>
      json({ error: { code, message: 'm' } }, status);

    /** 보통 요청(`fresh` 없음)과 `다시 계산`(`fresh=1`)의 응답을 따로 정하는 통제된 fetch. */
    function controlledFetch(onFresh: () => Response) {
      const state = { plain: 0, fresh: 0 };
      let release: (answer: () => Response) => void = () => {};
      let fail: (cause: unknown) => void = () => {};
      const fetchFn = vi.fn((input: RequestInfo | URL) => {
        if (String(input).includes('fresh=1')) {
          state.fresh += 1;
          return Promise.resolve(onFresh());
        }
        state.plain += 1;
        return new Promise<Response>((resolve, reject) => {
          release = (answer) => resolve(answer());
          fail = reject;
        });
      });
      return {
        state,
        fetch: fetchFn as unknown as typeof fetch,
        release: (answer: () => Response) => release(answer),
        fail: (cause: unknown) => fail(cause),
      };
    }

    const layerOf = (fetchFn: typeof fetch) =>
      RouteLookup.layerWith({ fetch: fetchFn, storage: null, schedule: () => {} });
    const leg = () => legRow('중앙시장 닭강정', '안목 카페거리');
    const newerBody = () => route(45, 9000, { queriedAt: '2026-10-13T03:00:00.000Z' });

    const lateFailures: [string, (c: ReturnType<typeof controlledFetch>) => void][] = [
      ['NO_ROUTE(404 본문)', (c) => c.release(() => errorBody('NO_ROUTE', 404))],
      ['TIMEOUT(504)', (c) => c.release(() => errorBody('TIMEOUT', 504))],
      ['OFFLINE(fetch 거부)', (c) => c.fail(new TypeError('Failed to fetch'))],
    ];

    it.each(lateFailures)(
      '먼저 시작한 보통 요청이 %s로 늦게 실패해도 나중에 시작한 다시 계산 결과를 지킨다',
      async (_name, failLate) => {
        const ctl = controlledFetch(() => json(newerBody()));
        const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P2]] }));
        await open(lib, { routes: { layer: layerOf(ctl.fetch), calls: [] } });
        const user = userEvent.setup();
        const notice = '인터넷에 연결되지 않아 이동 시간은 어림값이에요';

        await waitFor(() => expect(ctl.state.plain).toBe(1));
        await user.click(within(timeline()).getByRole('button', { name: '다시 계산' }));
        expect(await within(leg()).findByText('45분 · 9km')).toBeInTheDocument();
        expect(within(timeline()).getByText('10월 13일 조회')).toBeInTheDocument();

        await act(async () => {
          failLate(ctl);
        });
        await act(async () => {});
        expect(within(leg()).getByText('45분 · 9km')).toBeInTheDocument();
        expect(within(leg()).queryByText(/직선 추정/)).not.toBeInTheDocument();
        expect(within(leg()).queryByText('경로를 못 가져왔어요')).not.toBeInTheDocument();
        expect(within(timeline()).getByText('10월 13일 조회')).toBeInTheDocument();
        // 무시한 연결 실패는 안내를 띄우지 않는다.
        expect(screen.queryByText(notice)).not.toBeInTheDocument();
      },
    );

    it('이미 받은 경로 뒤에 시작한 다시 계산이 실패하면 그 실패를 보인다', async () => {
      const ctl = controlledFetch(() => errorBody('NO_ROUTE', 404));
      const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P2]] }));
      await open(lib, { routes: { layer: layerOf(ctl.fetch), calls: [] } });
      const user = userEvent.setup();

      await waitFor(() => expect(ctl.state.plain).toBe(1));
      await act(async () => {
        ctl.release(() => json(route(20, 5000, { queriedAt: '2026-10-12T03:00:00.000Z' })));
      });
      expect(await within(leg()).findByText('20분 · 5km')).toBeInTheDocument();

      await user.click(within(timeline()).getByRole('button', { name: '다시 계산' }));
      expect(await within(leg()).findByText('경로 없음 · 직선 추정')).toBeInTheDocument();
      expect(within(leg()).queryByText('20분 · 5km')).not.toBeInTheDocument();
      expect(ctl.state.fresh).toBe(1);
    });

    /** 중앙시장 닭강정 → 안목 카페거리 구간의 요청 주소(좌표 소수 5자리). */
    const P1_P2 = 'from=128.90000,37.75000&to=128.94700,37.77200';

    /**
     * 중앙시장 닭강정 → 안목 카페거리 구간의 요청을 붙잡아 두는 fetch. 보통 요청과 `다시 계산`을 따로,
     * 시작한 차례대로 쥐고 있다가 `answer`·`fail`로 하나씩 답한다. 다른 구간은 바로 답한다.
     */
    function holdingFetch() {
      type Kind = 'plain' | 'fresh';
      type Held = { resolve(res: Response): void; reject(cause: unknown): void };
      const held: Record<Kind, Held[]> = { plain: [], fresh: [] };
      const count = { plain: 0, fresh: 0, other: 0 };
      const fetchFn = vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (!url.includes(P1_P2)) {
          count.other += 1;
          return Promise.resolve(json(route(30, 24_000)));
        }
        const kind: Kind = url.includes('fresh=1') ? 'fresh' : 'plain';
        count[kind] += 1;
        return new Promise<Response>((resolve, reject) => held[kind].push({ resolve, reject }));
      });
      const take = (kind: Kind) => {
        const next = held[kind].shift();
        expect(next, `붙잡아 둔 ${kind} 요청`).toBeDefined();
        return next!;
      };
      return {
        count,
        total: () => fetchFn.mock.calls.length,
        fetch: fetchFn as unknown as typeof fetch,
        answer: (kind: Kind, res: Response) =>
          act(async () => {
            take(kind).resolve(res);
          }),
        fail: (kind: Kind, cause: unknown) =>
          act(async () => {
            take(kind).reject(cause);
          }),
      };
    }

    type Moves = {
      user: ReturnType<typeof userEvent.setup>;
      router: { navigate(to: string): unknown };
    };
    const rejoins: [string, (m: Moves) => Promise<void>][] = [
      [
        'Day 2로 갔다가 돌아와도',
        async ({ user }) => {
          await user.click(screen.getByRole('tab', { name: 'Day 2 10.24(토)' }));
          await user.click(screen.getByRole('tab', { name: 'Day 1 10.23(금)' }));
        },
      ],
      [
        '계획 화면을 나갔다가 다시 들어와도',
        async ({ router }) => {
          await act(async () => {
            await router.navigate('/trips');
          });
          await act(async () => {
            await router.navigate(`/trips/${TRIP}`);
          });
        },
      ],
    ];

    it.each(rejoins)(
      '보통 요청·다시 계산이 진행 중일 때 %s, 먼저 시작한 보통 요청의 늦은 실패가 다시 계산 결과를 덮지 않는다',
      async (_name, move) => {
        const ctl = holdingFetch();
        const lib = withTrip(
          plannerLibrary(),
          makeTrip({
            stops: [
              [P1, P2],
              [P3, P5],
            ],
          }),
        );
        const { router } = await open(lib, { routes: { layer: layerOf(ctl.fetch), calls: [] } });
        const user = userEvent.setup();

        await waitFor(() => expect(ctl.count.plain).toBe(1));
        await user.click(within(timeline()).getByRole('button', { name: '다시 계산' }));
        await waitFor(() => expect(ctl.count.fresh).toBe(1));
        // 화면을 옮기면 기다리던 조회가 취소되고, 새 조회가 진행 중인 요청에 합류한다.
        await move({ user, router });
        await act(async () => {});
        const fetched = ctl.total();

        await ctl.answer('fresh', json(newerBody()));
        expect(await within(leg()).findByText('45분 · 9km')).toBeInTheDocument();
        expect(within(timeline()).getByText('10월 13일 조회')).toBeInTheDocument();

        await ctl.answer('plain', errorBody('NO_ROUTE', 404));
        await act(async () => {});
        expect(within(leg()).getByText('45분 · 9km')).toBeInTheDocument();
        expect(within(leg()).queryByText(/직선 추정/)).not.toBeInTheDocument();
        expect(within(timeline()).getByText('10월 13일 조회')).toBeInTheDocument();
        // 다시 합류해도 서버 요청은 늘지 않는다(보통 1 · 다시 계산 1 · Day 2 구간 1).
        expect(ctl.total()).toBe(fetched);
        expect(ctl.count).toEqual({ plain: 1, fresh: 1, other: 1 });
      },
    );

    const newerFailures: [string, () => Response, string, boolean][] = [
      ['TIMEOUT(504)', () => errorBody('TIMEOUT', 504), '경로를 못 가져왔어요', true],
      ['NO_ROUTE(404 본문)', () => errorBody('NO_ROUTE', 404), '경로 없음 · 직선 추정', false],
    ];

    it.each(newerFailures)(
      '나중에 시작한 다시 계산이 %s로 실패한 뒤 먼저 시작한 보통 요청이 성공해도 그 실패를 보인다',
      async (_name, failure, text, retry) => {
        const ctl = holdingFetch();
        const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P2]] }));
        await open(lib, { routes: { layer: layerOf(ctl.fetch), calls: [] } });
        const user = userEvent.setup();
        const retryButton = () => within(leg()).queryByRole('button', { name: '다시 시도' });

        await waitFor(() => expect(ctl.count.plain).toBe(1));
        await user.click(within(timeline()).getByRole('button', { name: '다시 계산' }));
        await waitFor(() => expect(ctl.count.fresh).toBe(1));
        await ctl.answer('fresh', failure());
        expect(await within(leg()).findByText(text)).toBeInTheDocument();
        expect(retryButton() !== null).toBe(retry);

        await ctl.answer('plain', json(route(20, 5000, { queriedAt: '2026-10-12T03:00:00.000Z' })));
        await act(async () => {});
        expect(within(leg()).getByText(text)).toBeInTheDocument();
        expect(retryButton() !== null).toBe(retry);
        expect(within(leg()).queryByText('20분 · 5km')).not.toBeInTheDocument();
        expect(within(timeline()).queryByText(/조회$/)).not.toBeInTheDocument();
      },
    );

    it('다시 계산이 연결 실패로 끝나면, 인터넷이 돌아올 때 캐시의 이전 경로가 아니라 다시 계산으로 묻는다', async () => {
      const ctl = holdingFetch();
      const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P2]] }));
      await open(lib, { routes: { layer: layerOf(ctl.fetch), calls: [] } });
      const user = userEvent.setup();
      const notice = '인터넷에 연결되지 않아 이동 시간은 어림값이에요';

      await waitFor(() => expect(ctl.count.plain).toBe(1));
      await ctl.answer('plain', json(route(20, 5000, { queriedAt: '2026-10-12T03:00:00.000Z' })));
      expect(await within(leg()).findByText('20분 · 5km')).toBeInTheDocument();

      await user.click(within(timeline()).getByRole('button', { name: '다시 계산' }));
      await waitFor(() => expect(ctl.count.fresh).toBe(1));
      await ctl.fail('fresh', new TypeError('Failed to fetch'));
      expect(await screen.findByText(notice)).toBeInTheDocument();

      await act(async () => {
        window.dispatchEvent(new Event('online'));
      });
      await waitFor(() => expect(ctl.count.fresh).toBe(2));
      await ctl.answer('fresh', json(newerBody()));
      expect(await within(leg()).findByText('45분 · 9km')).toBeInTheDocument();
      expect(screen.queryByText(notice)).not.toBeInTheDocument();
      expect(ctl.count.plain).toBe(1);
    });

    it.each(rejoins)(
      '보통 요청·다시 계산이 진행 중일 때 %s, 합류한 보통 호출이 있어도 다시 계산의 연결 실패는 인터넷이 돌아올 때 다시 계산으로 묻는다',
      async (_name, move) => {
        const ctl = holdingFetch();
        const lib = withTrip(
          plannerLibrary(),
          makeTrip({
            stops: [
              [P1, P2],
              [P3, P5],
            ],
          }),
        );
        const { router } = await open(lib, { routes: { layer: layerOf(ctl.fetch), calls: [] } });
        const user = userEvent.setup();
        const notice = '인터넷에 연결되지 않아 이동 시간은 어림값이에요';

        await waitFor(() => expect(ctl.count.plain).toBe(1));
        await user.click(within(timeline()).getByRole('button', { name: '다시 계산' }));
        await waitFor(() => expect(ctl.count.fresh).toBe(1));
        // 화면을 옮기면 보통 호출이 진행 중인 다시 계산에 합류한다(같은 번호·종류의 답을 받는다).
        await move({ user, router });
        await act(async () => {});

        // 먼저 시작한 보통 요청이 성공해 캐시를 채운 뒤, 나중에 시작한 다시 계산이 연결 실패로 끝난다.
        await ctl.answer('plain', json(route(20, 5000, { queriedAt: '2026-10-12T03:00:00.000Z' })));
        await ctl.fail('fresh', new TypeError('Failed to fetch'));
        expect(await screen.findByText(notice)).toBeInTheDocument();
        expect(ctl.count).toMatchObject({ plain: 1, fresh: 1 });

        // 인터넷이 돌아오면 캐시의 이전 경로(보통 요청)가 아니라 다시 계산을 보낸다.
        await act(async () => {
          window.dispatchEvent(new Event('online'));
        });
        await waitFor(() => expect(ctl.count.fresh).toBe(2));
        expect(ctl.count.plain).toBe(1);
        await ctl.answer('fresh', json(newerBody()));
        expect(await within(leg()).findByText('45분 · 9km')).toBeInTheDocument();
        expect(within(timeline()).getByText('10월 13일 조회')).toBeInTheDocument();
        expect(screen.queryByText(notice)).not.toBeInTheDocument();
      },
    );
  });

  it('고른 Day의 구간을 먼저 요청하고 다른 Day도 미리 요청한다', async () => {
    const routes = fakeRoutes(() => route(10, 1000));
    const lib = withTrip(
      plannerLibrary(),
      makeTrip({
        stops: [
          [P5, P2],
          [P1, P3],
        ],
      }),
    );
    await open(lib, { routes });
    await waitFor(() => expect(routes.calls).toHaveLength(2));
    expect(routes.calls[0]).toMatchObject({ from: '창가 자리', to: '안목 카페거리' });
    expect(routes.calls[1]).toMatchObject({ from: '중앙시장 닭강정', to: '속초 횟집' });
  });

  it('같은 지점 구간(출발지 = 첫 장소)은 묻지 않고 0분 행도 보이지 않는다', async () => {
    const routes = fakeRoutes(() => route(12, 1100));
    const lib = withTrip(plannerLibrary(), makeTrip({ origin: P1, stops: [[P1, P2]] }));
    await open(lib, { routes });
    expect(
      await within(legRow('중앙시장 닭강정', '안목 카페거리')).findByText('12분 · 1.1km'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('listitem', { name: '중앙시장 닭강정 → 중앙시장 닭강정' }),
    ).not.toBeInTheDocument();
    expect(within(timeline()).queryByText(/^0분/)).not.toBeInTheDocument();
    expect(routes.calls.every((c) => c.from !== c.to)).toBe(true);
  });
});

describe('수단 바꾸기', () => {
  it('도보로 바꾸면 legModes에 저장하고 도보로 다시 요청한다', async () => {
    const routes = fakeRoutes((call) =>
      call.mode === 'walk' ? route(70, 5200, { mode: 'walk', toll: null }) : route(12, 1100),
    );
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P2]] }));
    const { store } = await open(lib, { routes });
    const user = userEvent.setup();

    const leg = legRow('중앙시장 닭강정', '안목 카페거리');
    expect(await within(leg).findByText('12분 · 1.1km')).toBeInTheDocument();
    expect(within(leg).getByText('자동차')).toBeInTheDocument();
    await user.click(within(leg).getByRole('button', { name: /이동 수단 바꾸기/ }));
    await user.click(screen.getByRole('menuitem', { name: '도보' }));

    await waitFor(() =>
      expect(store.get(libraryAtom).trips[TRIP]!.legModes.value).toEqual({
        [`${P1}>${P2}`]: 'walk',
      }),
    );
    const walkLeg = legRow('중앙시장 닭강정', '안목 카페거리');
    expect(await within(walkLeg).findByText('1시간 10분 · 5.2km')).toBeInTheDocument();
    expect(within(walkLeg).getByText('도보')).toBeInTheDocument();
    expect(routes.calls.some((c) => c.mode === 'walk' && c.to === '안목 카페거리')).toBe(true);
  });

  it('직선 50km를 넘는 구간은 도보를 고를 수 없다', async () => {
    const routes = fakeRoutes(() => route(60, 70_000));
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P2, P3]] }));
    await open(lib, { routes });
    const user = userEvent.setup();
    const leg = legRow('안목 카페거리', '속초 횟집');
    await user.click(within(leg).getByRole('button', { name: /이동 수단 바꾸기/ }));
    expect(screen.getByRole('menuitem', { name: '도보' })).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('Day 머리와 꼬리', () => {
  it('출발 시각을 바꾸면 도착 시각을 다시 계산하고, 빈 값은 저장하지 않는다', async () => {
    const routes = fakeRoutes(() => route(12, 1100));
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P2]] }));
    const { store } = await open(lib, { routes });
    expect(await within(stopRow('안목 카페거리')).findByText('09:12')).toBeInTheDocument();

    const input = within(timeline()).getByLabelText('출발 시각');
    expect(input).toHaveValue('09:00');
    fireEvent.change(input, { target: { value: '10:30' } });
    await waitFor(() =>
      expect(store.get(libraryAtom).trips[TRIP]!.days[0]!.startTime.value).toBe('10:30'),
    );
    expect(within(stopRow('중앙시장 닭강정')).getByText('10:30')).toBeInTheDocument();
    expect(within(stopRow('안목 카페거리')).getByText('10:42')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '' } });
    await act(async () => {});
    expect(store.get(libraryAtom).trips[TRIP]!.days[0]!.startTime.value).toBe('10:30');
  });

  it('출발점 이름을 보이고, 없으면 첫 장소에서 출발한다고 알린다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ origin: HOUSE, stops: [[P1], [P2]] }));
    await open(lib);
    expect(within(timeline()).getByText('바다 숙소')).toBeInTheDocument();
    expect(within(timeline()).getByRole('button', { name: '순서 정리' })).toBeDisabled();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Day 2 10.24(토)' }));
    expect(within(timeline()).getByText('첫 장소에서 출발')).toBeInTheDocument();
  });

  it('`일정 공유`는 여행 설정 옆에 있고, 이미 받은 구간은 다시 묻지 않는 일정 공유 창을 연다', async () => {
    const routes = fakeRoutes((call) =>
      route(12, 1100, {
        queriedAt:
          call.to === '안목 카페거리' ? '2026-10-16T03:00:00.000Z' : '2026-10-17T03:00:00.000Z',
      }),
    );
    const lib = withTrip(
      plannerLibrary(),
      makeTrip({
        stops: [
          [P1, P2],
          [P5, P3],
        ],
      }),
    );
    await open(lib, { routes });
    await waitFor(() => expect(routes.calls).toHaveLength(2));
    const user = userEvent.setup();
    const buttons = within(timeline())
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(buttons.indexOf('일정 공유')).toBe(buttons.indexOf('여행 설정') + 1);

    await user.click(within(timeline()).getByRole('button', { name: '일정 공유' }));
    // 창은 처음 열 때 받으므로 한 박자 동안은 기다림 틀이 뜨고, 실제 창이 그것을 바꿔 놓는다.
    await screen.findByRole('textbox', { name: '제목' });
    const dialog = screen.getByRole('dialog', { name: '일정 공유' });
    expect(within(dialog).getByText('Day 2개 · 일정 4곳')).toBeInTheDocument();
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      '이동 시간은 10월 16일 조회 기준이에요',
    );
    expect(routes.calls).toHaveLength(2);
  });

  it('숙소 정하기: 기본은 그날만, 체크하면 다음 날들도 같은 숙소', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ days: 3, stops: [[P1]] }));
    const { store } = await open(lib);
    const user = userEvent.setup();

    await user.click(within(timeline()).getByRole('button', { name: '숙소 정하기' }));
    let dialog = screen.getByRole('dialog', { name: '숙소 정하기' });
    expect(
      within(dialog).getByRole('checkbox', { name: '다음 날들도 같은 숙소' }),
    ).not.toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: /바다 숙소/ }));
    await waitFor(() =>
      expect(store.get(libraryAtom).trips[TRIP]!.days.map((d) => d.lodging.value)).toEqual([
        HOUSE,
        null,
        null,
      ]),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '숙소 정하기' })).toBeNull());
    expect(within(timeline()).getByText('바다 숙소')).toBeInTheDocument();

    await user.click(within(timeline()).getByRole('button', { name: '숙소 바꾸기' }));
    dialog = screen.getByRole('dialog', { name: '숙소 정하기' });
    await user.click(within(dialog).getByRole('checkbox', { name: '다음 날들도 같은 숙소' }));
    await user.click(within(dialog).getByRole('button', { name: /안목 카페거리/ }));
    await waitFor(() =>
      expect(store.get(libraryAtom).trips[TRIP]!.days.map((d) => d.lodging.value)).toEqual([
        P2,
        P2,
        P2,
      ]),
    );
  });

  it('다음 날들도 같은 숙소로 정한 것을 되돌리면 바뀐 Day 모두 이전 숙소로 돌아간다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ days: 3, stops: [[P1]] }));
    const { store } = await open(lib);
    const user = userEvent.setup();
    const lodgings = () => store.get(libraryAtom).trips[TRIP]!.days.map((d) => d.lodging.value);

    // Day 1만 바다 숙소.
    await user.click(within(timeline()).getByRole('button', { name: '숙소 정하기' }));
    await user.click(
      within(screen.getByRole('dialog', { name: '숙소 정하기' })).getByRole('button', {
        name: /바다 숙소/,
      }),
    );
    await waitFor(() => expect(lodgings()).toEqual([HOUSE, null, null]));
    expect(lastToast('숙소를 정했어요').action?.label).toBe('되돌리기');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '숙소 정하기' })).toBeNull());

    // Day 1부터 끝까지 안목 카페거리.
    await user.click(within(timeline()).getByRole('button', { name: '숙소 바꾸기' }));
    const dialog = screen.getByRole('dialog', { name: '숙소 정하기' });
    await user.click(within(dialog).getByRole('checkbox', { name: '다음 날들도 같은 숙소' }));
    await user.click(within(dialog).getByRole('button', { name: /안목 카페거리/ }));
    await waitFor(() => expect(lodgings()).toEqual([P2, P2, P2]));

    await undoLast('숙소를 정했어요');
    await waitFor(() => expect(lodgings()).toEqual([HOUSE, null, null]));
  });

  it('숙소 빼기: 그날 숙소를 비우고 되돌릴 수 있다', async () => {
    const lib = withTrip(
      plannerLibrary(),
      makeTrip({ days: 2, stops: [[P1]], lodging: [HOUSE, HOUSE] }),
    );
    const { store } = await open(lib);
    const user = userEvent.setup();
    const lodgings = () => store.get(libraryAtom).trips[TRIP]!.days.map((d) => d.lodging.value);

    await user.click(within(timeline()).getByRole('button', { name: '숙소 빼기' }));
    await waitFor(() => expect(lodgings()).toEqual([null, HOUSE]));
    expect(within(timeline()).getByRole('button', { name: '숙소 정하기' })).toBeInTheDocument();
    expect(within(timeline()).queryByRole('button', { name: '숙소 빼기' })).toBeNull();

    await undoLast('숙소를 뺐어요');
    await waitFor(() => expect(lodgings()).toEqual([HOUSE, HOUSE]));
    expect(within(timeline()).getByRole('button', { name: '숙소 빼기' })).toBeInTheDocument();
  });

  it('장소가 0곳인 Day는 안내를 보인다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ candidates: [P1] }));
    await open(lib);
    expect(within(timeline()).getByText('장소를 넣어 보세요')).toBeInTheDocument();
  });
});

describe('Day 탭', () => {
  it('탭을 바꾸면 그 Day의 시간표와 ＋의 대상이 바뀐다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[], [P5]], candidates: [P1] }));
    await open(lib);
    const user = userEvent.setup();

    expect(screen.getByRole('tab', { name: 'Day 1 10.23(금)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(timeline()).getByText('장소를 넣어 보세요')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '중앙시장 닭강정을 Day 1에 넣기' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Day 2 10.24(토)' }));
    expect(screen.getByRole('tab', { name: 'Day 2 10.24(토)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(timeline()).getByText('창가 자리')).toBeInTheDocument();
    expect(within(timeline()).queryByText('장소를 넣어 보세요')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '중앙시장 닭강정을 Day 2에 넣기' }),
    ).toBeInTheDocument();
  });
});

describe('화면 열기', () => {
  it('보관함에서 지운 장소가 있으면 토스트를 한 번 보인다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, GONE], [P5]] }));
    await open(lib);
    const user = userEvent.setup();
    expect(within(timeline()).queryByText('지운 가게')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Day 2 10.24(토)' }));
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0]![0]).toBe('보관함에서 지운 1곳은 일정에서 빠졌어요');
  });

  it('지운 장소가 없으면 토스트를 보이지 않는다', async () => {
    await open(withTrip(plannerLibrary(), makeTrip({ stops: [[P1]] })));
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('없는 여행이면 안내와 여행 목록으로 가는 링크', async () => {
    const { router } = await open(plannerLibrary(), { path: '/trips/nothing000' });
    expect(screen.getByText('여행을 찾지 못했어요')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: '여행 목록으로' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/trips'));
  });

  it('넓은 화면은 후보 칸·지도 자리·시간표 칸을 나란히 둔다', async () => {
    await open(withTrip(plannerLibrary(), makeTrip()));
    expect(screen.getByRole('region', { name: '후보 칸' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '지도' })).toBeInTheDocument();
    expect(timeline()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '후보 칸 접기' })).not.toBeInTheDocument();
  });

  it('중간 폭에서는 후보 칸을 접고 펼칠 수 있다', async () => {
    // 1100px 이상이면 펼친 채 시작한다(1100px 미만의 기본값은 planner-layout.test.tsx).
    await open(withTrip(plannerLibrary(), makeTrip({ candidates: [P1] })), { width: 1100 });
    const user = userEvent.setup();
    expect(screen.getByRole('region', { name: '후보 칸' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '후보 칸 접기' }));
    expect(screen.queryByRole('region', { name: '후보 칸' })).not.toBeInTheDocument();
    expect(timeline()).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '후보 칸 펼치기' }));
    expect(screen.getByRole('region', { name: '후보 칸' })).toBeInTheDocument();
  });

  it('좁은 화면은 지도 자리와 일정 시트(후보·Day 탭, 높이 세 단계)', async () => {
    await open(withTrip(plannerLibrary(), makeTrip({ stops: [[P5]], candidates: [P1, P2] })), {
      width: 375,
    });
    const user = userEvent.setup();
    expect(screen.getByRole('region', { name: '지도' })).toBeInTheDocument();
    const sheet = screen.getByRole('region', { name: '일정 시트' });
    expect(within(sheet).getByRole('tab', { name: '후보 2' })).toBeInTheDocument();
    expect(within(sheet).getByRole('tab', { name: 'Day 1' })).toBeInTheDocument();
    expect(within(sheet).getByRole('tab', { name: 'Day 2' })).toBeInTheDocument();

    // 후보 탭이 기본이고 ＋는 Day 1에 넣는다.
    expect(
      within(sheet).getByRole('button', { name: '중앙시장 닭강정을 Day 1에 넣기' }),
    ).toBeInTheDocument();

    await user.click(within(sheet).getByRole('tab', { name: 'Day 1' }));
    expect(within(sheet).getByText('창가 자리')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('출발 시각')).toBeInTheDocument();

    const handle = within(sheet).getByRole('button', { name: '시트 높이 바꾸기' });
    expect(sheet).toHaveAttribute('data-snap', 'half');
    await user.click(handle);
    expect(sheet).toHaveAttribute('data-snap', 'full');
    await user.click(handle);
    expect(sheet).toHaveAttribute('data-snap', 'collapsed');
    // 접힌 상태에서 탭을 누르면 반쯤 연다.
    await user.click(within(sheet).getByRole('tab', { name: 'Day 2' }));
    expect(sheet).toHaveAttribute('data-snap', 'half');
  });
});

describe('검토 반영', () => {
  it('Day 2를 고른 채 열면 Day 2의 구간을 Day 1보다 먼저 요청한다', async () => {
    const routes = fakeRoutes(() => route(10, 1000));
    const lib = withTrip(
      plannerLibrary(),
      makeTrip({
        stops: [
          [P5, P2],
          [P1, P3],
        ],
      }),
    );
    const { router, store } = await open(lib, { routes, path: '/trips' });
    expect(routes.calls).toHaveLength(0);
    store.set(selectedDayAtom, { [TRIP]: 1 });
    await act(async () => {
      await router.navigate(`/trips/${TRIP}`);
    });
    await waitFor(() => expect(routes.calls).toHaveLength(2));
    expect(routes.calls[0]).toMatchObject({ from: '중앙시장 닭강정', to: '속초 횟집' });
    expect(routes.calls[1]).toMatchObject({ from: '창가 자리', to: '안목 카페거리' });
    expect(screen.getByRole('tab', { name: 'Day 2 10.24(토)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('인터넷이 돌아오면(online) 연결 실패 구간을 다시 묻고 안내를 거둔다', async () => {
    let online = false;
    const routes = fakeRoutes(() => (online ? route(12, 1100) : 'OFFLINE'));
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P2]] }));
    await open(lib, { routes });
    const notice = '인터넷에 연결되지 않아 이동 시간은 어림값이에요';
    expect(await screen.findByText(notice)).toBeInTheDocument();
    const before = routes.calls.length;

    online = true;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    const leg = legRow('중앙시장 닭강정', '안목 카페거리');
    expect(await within(leg).findByText('12분 · 1.1km')).toBeInTheDocument();
    expect(screen.queryByText(notice)).not.toBeInTheDocument();
    expect(routes.calls.length).toBe(before + 1);
    expect(routes.calls.at(-1)).toMatchObject({ to: '안목 카페거리', refresh: false });
  });

  it('useDayPlan은 상관없는 다시 그리기·문서 변경에도 같은 참조를 돌려준다', async () => {
    const routes = fakeRoutes(() => route(12, 1100));
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P2]] }));
    // 앱은 목록에 두고(런타임·보관함 준비), 같은 저장소로 훅만 따로 그린다.
    const { store } = await open(lib, { routes, path: '/trips' });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result, rerender } = renderHook(() => useDayPlan(TRIP, 0), { wrapper });
    await waitFor(() => expect(result.current.legs[0]?.status).toBe('routed'));
    const first = result.current;

    rerender();
    expect(result.current).toBe(first);
    expect(result.current.legs).toBe(first.legs);
    expect(result.current.schedule).toBe(first.schedule);
    expect(result.current.refresh).toBe(first.refresh);
    expect(result.current.retryLeg).toBe(first.retryLeg);

    // 이 Day와 상관없는 장소(강남 한 곳)의 메모만 바뀐 문서.
    act(() => {
      const current = store.get(libraryAtom);
      const other = current.places['place00004']!;
      store.set(libraryAtom, {
        ...current,
        places: {
          ...current.places,
          [other.id]: { ...other, memo: { value: '새 메모', updatedAt: T0 } },
        },
      });
    });
    expect(result.current.legs).toBe(first.legs);
    expect(result.current.schedule).toBe(first.schedule);

    // 출발 시각이 바뀌면 시각은 새로 계산하지만 구간은 그대로다.
    act(() => {
      const current = store.get(libraryAtom);
      const trip = current.trips[TRIP]!;
      const days = trip.days.map((d, i) =>
        i === 0 ? { ...d, startTime: { value: '10:00', updatedAt: T0 } } : d,
      );
      store.set(libraryAtom, { ...current, trips: { [TRIP]: { ...trip, days } } });
    });
    expect(result.current.legs).toBe(first.legs);
    expect(result.current.schedule).not.toBe(first.schedule);
    expect(result.current.schedule.points[0]!.arriveMin).toBe(600);
  });

  it('시트 손잡이를 끌면 끈 방향으로 한 단계 바뀌고, 그 뒤 키보드로도 바꿀 수 있다', async () => {
    await open(withTrip(plannerLibrary(), makeTrip({ candidates: [P1] })), { width: 375 });
    const sheet = screen.getByRole('region', { name: '일정 시트' });
    const handle = within(sheet).getByRole('button', { name: '시트 높이 바꾸기' });
    expect(sheet).toHaveAttribute('data-snap', 'half');

    // 위로 끌기 → 거의 전체. 끈 뒤 click이 따라오지 않는다.
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 400 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 300 });
    expect(sheet).toHaveAttribute('data-snap', 'full');

    // 키보드로 누르면 한 단계 돈다(끌기 표시가 남아 있어도 막히지 않는다).
    handle.focus();
    const user = userEvent.setup();
    await user.keyboard('{Enter}');
    expect(sheet).toHaveAttribute('data-snap', 'collapsed');

    // 아래로 끌기는 접힘에서 더 내려가지 않고, 위로 끌면 반쯤.
    fireEvent.pointerDown(handle, { pointerId: 2, clientY: 300 });
    fireEvent.pointerCancel(handle, { pointerId: 2 });
    fireEvent.pointerUp(handle, { pointerId: 2, clientY: 400 });
    expect(sheet).toHaveAttribute('data-snap', 'collapsed');
    fireEvent.pointerDown(handle, { pointerId: 3, clientY: 400 });
    fireEvent.pointerUp(handle, { pointerId: 3, clientY: 340 });
    expect(sheet).toHaveAttribute('data-snap', 'half');

    // 다른 포인터의 up·cancel은 지금 끌기를 끝내지 않는다.
    fireEvent.pointerDown(handle, { pointerId: 4, clientY: 400 });
    fireEvent.pointerUp(handle, { pointerId: 5, clientY: 400 });
    fireEvent.pointerCancel(handle, { pointerId: 5 });
    fireEvent.pointerUp(handle, { pointerId: 4, clientY: 300 });
    expect(sheet).toHaveAttribute('data-snap', 'full');
  });
});
