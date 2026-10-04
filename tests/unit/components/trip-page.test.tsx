import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, type ReactNode } from 'react';
import { createStore } from 'jotai';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from 'src/app';
import { ReconcileBanner } from 'src/components/ReconcileBanner';
import { hashDayStops } from 'src/domain/day-hash';
import type { ReconcileReport } from 'src/domain/reconcile';
import { createMemoryStorage, storageKey } from 'src/repositories/edit-layer-repo';
import { routes } from 'src/routes/router';
import type { EditLayer } from 'src/schema/edit-layer';
import type { TripData } from 'src/schema/trip-data';
import { TripDepsContext } from 'src/stores/trip-store';
import { modeAtom, selectedDayAtom } from 'src/stores/ui-store';
import { makeEdit, makeTrip, sid } from '../../fixtures/builders';

const PID = 'testtrip0001';
const KEY = storageKey(PID);
const NOW_MS = 1759460000000;
const NOW_ISO = '2026-10-03T02:00:00.000Z';
const OLD = '2026-10-03T00:30:00.000Z';
const D1 = '2026-11-14';
const D2 = '2026-11-15';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function renderAt(
  url: string,
  opts: { trip?: TripData; response?: Response; storage?: Storage; strict?: boolean } = {},
) {
  const storage = opts.storage ?? createMemoryStorage();
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => opts.response ?? jsonResponse(opts.trip));
  const store = createStore();
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  const wrap = (node: ReactNode) => (opts.strict ? <StrictMode>{node}</StrictMode> : node);
  render(
    wrap(
      <TripDepsContext
        value={{ storage, fetchFn, now: () => NOW_MS, nowIso: () => NOW_ISO, jotaiStore: store }}
      >
        <AppProviders>
          <RouterProvider router={router} />
        </AppProviders>
      </TripDepsContext>,
    ),
  );
  return { storage, store, router };
}

const saved = (storage: Storage): EditLayer => JSON.parse(storage.getItem(KEY)!) as EditLayer;

// 라우트가 TripPage를 지연 로드하므로, 부하가 큰 전체 실행에서 첫 테스트가 findBy 시간을 넘지 않게 미리 불러 둔다.
beforeAll(async () => {
  await import('src/pages/TripPage');
}, 20_000);

beforeEach(() => {
  window.localStorage.clear();
});

describe('라우트 오류 화면', () => {
  function Boom(): ReactNode {
    throw new Error('boom');
  }

  it('홈·여행 라우트에 errorElement가 있고, 렌더 오류면 한국어 안내와 새로고침 버튼을 보여 준다', async () => {
    const withError = routes.filter((r) => r.path !== '*');
    expect(withError.length).toBeGreaterThanOrEqual(2);
    for (const r of withError) expect(r.errorElement).toBeTruthy();

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const router = createMemoryRouter(
      [{ path: '/', element: <Boom />, errorElement: routes[1]!.errorElement }],
      { initialEntries: ['/'] },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByText('문제가 생겨 화면을 표시하지 못했어요')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '새로고침' }));
    expect(reload).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    vi.unstubAllGlobals();
    error.mockRestore();
  });
});

describe('라우트', () => {
  it('/는 안내 문구만 보여 주고 여행 목록·링크가 없다', () => {
    renderAt('/');
    expect(screen.getByText('공유받은 링크로 접속하세요')).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryAllByRole('list')).toHaveLength(0);
  });

  it('404면 만료 안내', async () => {
    renderAt(`/t/${PID}`, { response: new Response('nope', { status: 404 }) });
    expect(await screen.findByText('링크가 잘못되었거나 만료된 여행입니다')).toBeInTheDocument();
  });

  it('검증 실패면 schemaVersion과 첫 오류', async () => {
    const trip = makeTrip({ days: { [D1]: ['A'] } });
    renderAt(`/t/${PID}`, { response: jsonResponse({ ...trip, schemaVersion: 7 }) });
    expect(await screen.findByText(/schemaVersion: 7/)).toBeInTheDocument();
    expect(screen.getByText(/schemaVersion:.*expected 1|Invalid input/i)).toBeInTheDocument();
  });

  it('?mode=itinerary&day=2 → modeAtom·selectedDayAtom', async () => {
    const trip = makeTrip({ days: { [D1]: ['A'], [D2]: ['B'] } });
    const { store } = renderAt(`/t/${PID}?mode=itinerary&day=2`, { trip });
    expect(await screen.findByText('테스트 여행')).toBeInTheDocument();
    expect(store.get(modeAtom)).toBe('itinerary');
    expect(store.get(selectedDayAtom)).toBe(D2);
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: '일정' })).toHaveAttribute('aria-pressed', 'true'),
    );
  });

  it('StrictMode에서도 ?mode=itinerary&day=2 딥 링크가 유지되고, [탐색]은 URL을 한 번만 바꾼다', async () => {
    const trip = makeTrip({ days: { [D1]: ['A'], [D2]: ['B'] } });
    const { router } = renderAt(`/t/${PID}?mode=itinerary&day=2`, { trip, strict: true });
    const panel = await screen.findByTestId('itinerary-panel');
    expect(within(panel).getByRole('tab', { name: 'Day 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(panel).getByRole('region', { name: 'Day 2 (11/15)' })).toBeInTheDocument();
    expect(within(panel).queryByRole('region', { name: 'Day 1 (11/14)' })).toBeNull();
    // effect가 모두 끝난 뒤에도 쿼리가 그대로다.
    await new Promise((r) => setTimeout(r, 50));
    expect(router.state.location.search).toBe('?mode=itinerary&day=2');

    const changes: string[] = [];
    let key = router.state.location.key;
    const unsubscribe = router.subscribe((state) => {
      if (state.location.key === key) return;
      key = state.location.key;
      changes.push(state.location.search);
    });
    await userEvent.click(screen.getByRole('button', { name: '탐색' }));
    await screen.findByTestId('explore-panel');
    await new Promise((r) => setTimeout(r, 50));
    unsubscribe();
    expect(changes).toEqual(['?day=2']);
    expect(router.state.location.search).toBe('?day=2');
  });

  it('모드 전환이 URL 쿼리에 반영된다', async () => {
    const trip = makeTrip({ days: { [D1]: ['A'] } });
    const { router } = renderAt(`/t/${PID}`, { trip });
    await userEvent.click(await screen.findByRole('button', { name: '일정' }));
    expect(router.state.location.search).toContain('mode=itinerary');
  });
});

describe('미해결 원본 변경 배너', () => {
  const v1 = makeTrip({ days: { [D1]: ['X'], [D2]: [] } });
  const v2 = makeTrip({ days: { [D1]: [], [D2]: ['X'] } });
  const movedEdit = () =>
    makeEdit({
      days: {
        [D1]: {
          mode: 'override',
          stops: [{ ...v1.days[0]!.stops[0]!, note: '내 메모' }],
          baseDayHash: hashDayStops(v1.days[0]!.stops),
          updatedAt: OLD,
        },
      },
    });

  it('[내 편집 유지] → keepMine 결과 저장, 배너 사라짐', async () => {
    const storage = createMemoryStorage();
    storage.setItem(KEY, JSON.stringify(movedEdit()));
    renderAt(`/t/${PID}`, { trip: v2, storage });
    expect(await screen.findByText('Day 1 원본이 바뀌었어요(관련: Day 2)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '원본 보기' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '내 편집 유지' }));
    await vi.waitFor(() => expect(screen.queryByText(/원본이 바뀌었어요/)).not.toBeInTheDocument());
    const day2 = saved(storage).days[D2]!;
    expect(day2).toEqual({
      mode: 'override',
      stops: [],
      baseDayHash: hashDayStops(v2.days[1]!.stops),
      updatedAt: NOW_ISO,
    });
  });

  it('[원본 보기] → 묶음 전체 reset, 배너 사라짐', async () => {
    const storage = createMemoryStorage();
    storage.setItem(KEY, JSON.stringify(movedEdit()));
    renderAt(`/t/${PID}`, { trip: v2, storage });
    await userEvent.click(await screen.findByRole('button', { name: '원본 보기' }));
    await vi.waitFor(() => expect(screen.queryByText(/원본이 바뀌었어요/)).not.toBeInTheDocument());
    expect(saved(storage).days).toEqual({
      [D1]: { mode: 'reset', updatedAt: NOW_ISO },
      [D2]: { mode: 'reset', updatedAt: NOW_ISO },
    });
  });

  it('keepMine이 null이면 [원본 보기]만 남는다', async () => {
    const trip = makeTrip({ days: { [D1]: ['X', 'A'], [D2]: ['B'] } });
    const [sx, sa] = trip.days[0]!.stops;
    const sb = trip.days[1]!.stops[0]!;
    expect(sa).toBeDefined();
    const storage = createMemoryStorage();
    storage.setItem(
      KEY,
      JSON.stringify(
        makeEdit({
          days: {
            [D1]: { mode: 'override', stops: [sx!], baseDayHash: 'old', updatedAt: OLD },
            [D2]: { mode: 'override', stops: [sx!, sb], baseDayHash: 'old', updatedAt: OLD },
          },
        }),
      ),
    );
    renderAt(`/t/${PID}`, { trip, storage });
    expect(await screen.findByText(/원본이 바뀌었어요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '원본 보기' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '내 편집 유지' })).not.toBeInTheDocument();
    expect(sid('X')).toBe(sx!.id);
  });
});

describe('ReconcileBanner 정리 알림', () => {
  it('고아 2건·제거 방문 1건이면 그 두 줄만', () => {
    const report: ReconcileReport = {
      removedStops: [{ date: D1, stopId: 'zz00', placeKey: 'n:99' }],
      orphanPlaceKeys: ['n:77', 'n:78'],
      hiddenEditDates: [],
      autoResetDates: [],
      unresolvedGroups: [],
    };
    const { container } = render(
      <ReconcileBanner
        report={report}
        isUnresolved={() => false}
        dayLabel={() => 'Day 1'}
        canKeepMine={() => true}
        onRevert={() => {}}
        onKeepMine={() => {}}
      />,
    );
    expect(screen.getByText('원본에서 사라진 장소 1곳을 일정에서 뺐어요')).toBeInTheDocument();
    expect(
      screen.getByText('사라진 장소의 메모 2건을 보관 중이에요 — 내보내기에 포함돼요'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/여행 기간에서 빠진 날짜/)).not.toBeInTheDocument();
    expect(screen.queryByText(/원본이 바뀌었어요/)).not.toBeInTheDocument();
    expect(within(container).queryAllByRole('button')).toHaveLength(0);
  });
});

describe('설정 메뉴', () => {
  it('닉네임 변경 → authors[authorId] 갱신, updatedAt 지금', async () => {
    const trip = makeTrip({ days: { [D1]: ['A'] } });
    const storage = createMemoryStorage();
    storage.setItem(KEY, JSON.stringify(makeEdit()));
    renderAt(`/t/${PID}`, { trip, storage });
    await userEvent.click(await screen.findByRole('button', { name: '설정' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '닉네임 변경' }));
    const input = await screen.findByLabelText('닉네임');
    expect(input).toHaveValue('나');
    await userEvent.clear(input);
    await userEvent.type(input, '길동');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    await vi.waitFor(() =>
      expect(saved(storage).authors['a-local']).toEqual({ nickname: '길동', updatedAt: NOW_ISO }),
    );
  });
});
