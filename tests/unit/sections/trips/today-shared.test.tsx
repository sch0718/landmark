import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { visitedOnOf } from 'src/domain/library/visit';
import type { SharedProgress } from 'src/domain/trip-collab/progress';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { libraryAtom } from 'src/stores/library-state';
import { P1, P2, P5 } from './planner-fixtures';
import {
  nextCard,
  NOW,
  plannerLibrary,
  remainingList,
  renderToday,
  slowLocks,
  todayTrip,
  TRIP,
  withTrip,
  withVisited,
} from './today-fixtures';

const mocks = vi.hoisted(() => ({ queueProgress: vi.fn(), setNext: vi.fn(), toast: vi.fn() }));
let progress: SharedProgress | null;
let connected = true;
vi.mock('src/sections/trips/collab/use-trip-collab', async (original) => ({
  ...(await original<typeof import('src/sections/trips/collab/use-trip-collab')>()),
  useTripCollab: () => ({
    record: connected ? { status: 'live', deviceId: 'mydevice01', label: '내 폰' } : undefined,
    progress,
    engine: { queueProgress: mocks.queueProgress, setNext: mocks.setNext },
  }),
}));
vi.mock('sonner', async (original) => ({
  ...(await original<typeof import('sonner')>()),
  toast: mocks.toast,
}));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));
const trip = () => todayTrip({ stops: [[P1, P2, P5]] });
const lib = () => withTrip(plannerLibrary(), trip());
const stopId = (index: number) => trip().days[0]!.stops.value[index]!.id;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  connected = true;
  progress = { prev: 1, marks: [], next: null };
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('다른 기기 표시를 다녀온 곳에 보이고 개인 visitedOn은 바꾸지 않는다', async () => {
  progress!.marks.push({
    stopId: stopId(0),
    date: '2026-10-24',
    at: NOW.toISOString(),
    by: { device: 'other00001', label: '민지 폰' },
  });
  const { store } = await renderToday(lib());
  expect(within(nextCard()).getByRole('heading')).toHaveTextContent('안목 카페거리');
  await userEvent.setup().click(screen.getByRole('button', { name: '다녀온 곳 1곳' }));
  expect(screen.getByText('다녀옴 · 민지 폰')).toBeVisible();
  expect(visitedOnOf(store.get(libraryAtom).places[P1]!)).toBeNull();
  expect(mocks.queueProgress).not.toHaveBeenCalled();
});
it('체크와 되돌리기가 개인 기록과 공동 대기열에 각각 쓰인다', async () => {
  const { store } = await renderToday(lib());
  await userEvent.setup().click(screen.getByRole('checkbox', { name: '‘중앙시장 닭강정’ 다녀옴' }));
  await waitFor(() =>
    expect(mocks.queueProgress).toHaveBeenCalledWith({
      stopId: stopId(0),
      visited: true,
      date: '2026-10-24',
    }),
  );
  expect(visitedOnOf(store.get(libraryAtom).places[P1]!)).toBe('2026-10-24');
  const undo = mocks.toast.mock.calls.find((call) => call[1]?.action)?.[1].action.onClick;
  expect(undo).toBeTypeOf('function');
  await act(async () => {
    await undo();
  });
  await waitFor(() =>
    expect(mocks.queueProgress).toHaveBeenLastCalledWith({
      stopId: stopId(0),
      visited: false,
      date: '2026-10-24',
    }),
  );
  expect(visitedOnOf(store.get(libraryAtom).places[P1]!)).toBeNull();
});
it('정한 다음 장소가 우선하고 정한 기기 이름을 보인다', async () => {
  progress!.next = {
    stopId: stopId(2),
    date: '2026-10-24',
    at: NOW.toISOString(),
    label: '민지 폰',
  };
  await renderToday(lib());
  expect(within(nextCard()).getByRole('heading')).toHaveTextContent('창가 자리');
  expect(within(nextCard()).getByText(/‘민지 폰’에서 정함/)).toBeVisible();
  expect(screen.getByText('함께 진행')).toBeVisible();
});
it('내가 정한 다음 장소에는 내 기기 이름을 붙이지 않는다', async () => {
  progress!.next = { stopId: stopId(1), date: '2026-10-24', at: NOW.toISOString(), label: '내 폰' };
  await renderToday(lib());
  expect(within(nextCard()).getByRole('heading')).toHaveTextContent('안목 카페거리');
  expect(within(nextCard()).queryByText(/에서 정함/)).toBeNull();
});
it('고른 장소를 모두의 다음 장소로 정한다', async () => {
  await renderToday(lib());
  const user = userEvent.setup();
  await user.click(within(remainingList()).getByRole('button', { name: '2. 안목 카페거리' }));
  await user.click(screen.getByRole('button', { name: '다음 장소로 정하기' }));
  expect(mocks.setNext).toHaveBeenCalledWith(stopId(1), '2026-10-24');
  expect(mocks.toast).toHaveBeenCalledWith('모두에게 다음 장소로 보여요');
});
it('공동 진행을 아직 못 받았으면 개인 표시로 보인다', async () => {
  progress = null;
  await renderToday(withVisited(lib(), P1, '2026-10-24'));
  expect(within(nextCard()).getByRole('heading')).toHaveTextContent('안목 카페거리');
});
it('연결 기록이 없으면 개인 동작 그대로이고 공동 요청이 없다', async () => {
  connected = false;
  const { store } = await renderToday(lib());
  await userEvent.setup().click(screen.getByRole('checkbox', { name: '‘중앙시장 닭강정’ 다녀옴' }));
  await waitFor(() => expect(visitedOnOf(store.get(libraryAtom).places[P1]!)).toBe('2026-10-24'));
  expect(mocks.queueProgress).not.toHaveBeenCalled();
  expect(screen.queryByText('함께 진행')).toBeNull();
  expect(store.get(libraryAtom).trips[TRIP]).toBeDefined();
});

it.each([null, '2025-05-01'])(
  '다른 기기의 공동 체크를 풀고 되돌리면 개인 날짜 %s와 공동 체크를 각각 복원한다',
  async (previous) => {
    progress!.marks.push({
      stopId: stopId(0),
      date: '2026-10-24',
      at: NOW.toISOString(),
      by: { device: 'other00001', label: '민지 폰' },
    });
    const { store } = await renderToday(withVisited(lib(), P1, previous));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '다녀온 곳 1곳' }));
    await user.click(screen.getByRole('checkbox', { name: '‘중앙시장 닭강정’ 다녀옴' }));
    await waitFor(() =>
      expect(mocks.queueProgress).toHaveBeenLastCalledWith({
        stopId: stopId(0),
        visited: false,
        date: '2026-10-24',
      }),
    );
    const undo = mocks.toast.mock.calls.find((call) => call[1]?.action)?.[1].action.onClick;
    expect(undo).toBeTypeOf('function');
    await act(async () => {
      await undo();
    });
    await waitFor(() =>
      expect(mocks.queueProgress).toHaveBeenLastCalledWith({
        stopId: stopId(0),
        visited: true,
        date: '2026-10-24',
      }),
    );
    expect(visitedOnOf(store.get(libraryAtom).places[P1]!)).toBe(previous);
  },
);
it('Day를 바꿔도 원래 Stop의 공동 체크를 되돌린다', async () => {
  await renderToday(lib());
  const user = userEvent.setup();
  await user.click(screen.getByRole('checkbox', { name: '‘중앙시장 닭강정’ 다녀옴' }));
  await waitFor(() => expect(mocks.queueProgress).toHaveBeenCalled());
  const undo = mocks.toast.mock.calls.find((call) => call[1]?.action)?.[1].action.onClick;
  await user.click(screen.getByRole('button', { name: '오늘 일정 메뉴' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'Day 2 · 10.25(일)' }));
  await act(async () => {
    await undo();
  });
  await waitFor(() =>
    expect(mocks.queueProgress).toHaveBeenLastCalledWith({
      stopId: stopId(0),
      visited: false,
      date: '2026-10-24',
    }),
  );
});
it('오늘이 아닌 Day의 장소는 모두의 다음 장소로 정하지 않는다', async () => {
  await renderToday(withTrip(plannerLibrary(), todayTrip({ stops: [[P1], [P2, P5]] })));
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '오늘 일정 메뉴' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'Day 2 · 10.25(일)' }));
  await user.click(within(remainingList()).getByRole('button', { name: '2. 창가 자리' }));
  expect(screen.queryByRole('button', { name: '다음 장소로 정하기' })).toBeNull();
});

it('체크 저장 중 Day를 바꿔도 누른 Stop의 공동 진행을 보낸다', async () => {
  const locks = slowLocks();
  await renderToday(lib(), { libraryLocks: locks.locks });
  locks.hold();
  try {
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: '‘중앙시장 닭강정’ 다녀옴' }));
    await user.click(screen.getByRole('button', { name: '오늘 일정 메뉴' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Day 2 · 10.25(일)' }));
  } finally {
    locks.release();
  }
  await waitFor(() =>
    expect(mocks.queueProgress).toHaveBeenCalledWith({
      stopId: stopId(0),
      visited: true,
      date: '2026-10-24',
    }),
  );
});
