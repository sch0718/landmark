import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { libraryAtom } from 'src/stores/library-state';
import { selectedDayAtom } from 'src/stores/trip-planner';
import { installMapResources } from '../../components/helpers/map-resources';
import { HOUSE, P1, P2, P5 } from './planner-fixtures';
import {
  nextCard,
  NOW,
  plannerLibrary,
  remainingList,
  remainingRows,
  renderToday,
  todayTrip,
  TRIP,
  withDeleted,
  withTrip,
  withVisited,
} from './today-fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.title = '';
});

/** Day 1: 중앙시장 닭강정 → 안목 카페거리, Day 2: 창가 자리. */
const lib = (options: Parameters<typeof todayTrip>[0] = {}) =>
  withTrip(plannerLibrary(), todayTrip({ stops: [[P1, P2], [P5]], ...options }));

const cardHead = (text: string) => within(nextCard()).getByText(text);
const cardTitle = () => within(nextCard()).getByRole('heading', { level: 2 });
const subtitle = (text: string) => screen.getByText(text);

describe('당일 모드: 제목·머리', () => {
  it('h1은 `오늘 일정` 하나, 탭 제목과 머리 부제에 여행 제목·Day·날짜', async () => {
    await renderToday(lib());
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
      '오늘 일정',
    ]);
    expect(document.title).toBe('오늘 일정 · 강릉 여행 · 랜드마크');
    expect(subtitle('강릉 여행 · Day 1 · 10.24(토)')).toBeInTheDocument();
  });

  it('없는 여행이면 `여행을 찾지 못했어요`', async () => {
    await renderToday(lib(), { path: '/trips/nothere000/today' });
    expect(screen.getByRole('heading', { level: 1, name: '여행을 찾지 못했어요' })).toBeVisible();
    expect(screen.getByRole('link', { name: '여행 목록으로' })).toHaveAttribute('href', '/trips');
    expect(document.title).toBe('랜드마크');
  });

  it('`계획 화면으로`는 계획 화면으로 가고, 보던 Day를 계획 화면의 고른 Day로 맞춘다', async () => {
    const { router, store } = await renderToday(lib());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '오늘 일정 메뉴' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Day 2 · 10.25(일)' }));
    await user.click(screen.getByRole('link', { name: '계획 화면으로' }));
    expect(router.state.location.pathname).toBe(`/trips/${TRIP}`);
    expect(store.get(selectedDayAtom)[TRIP]).toBe(1);
  });

  it('메뉴의 `계획 화면으로`도 같다', async () => {
    const { router, store } = await renderToday(lib());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '오늘 일정 메뉴' }));
    await user.click(screen.getByRole('menuitem', { name: '계획 화면으로' }));
    expect(router.state.location.pathname).toBe(`/trips/${TRIP}`);
    expect(store.get(selectedDayAtom)[TRIP]).toBe(0);
  });
});

describe('당일 모드: 다음 장소 카드와 남은 일정', () => {
  it('카드는 첫 Stop, 남은 일정은 그날 Stop 수만큼', async () => {
    await renderToday(lib());
    expect(cardHead('다음 · 1번째')).toBeInTheDocument();
    expect(cardTitle()).toHaveTextContent('중앙시장 닭강정');
    expect(within(nextCard()).getByText('계획 도착 09:00')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '남은 일정 2곳' })).toBeInTheDocument();
    const rows = remainingRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('1. 중앙시장 닭강정');
    expect(rows[0]).toHaveTextContent('09:00 도착 예정');
    expect(rows[0]).toHaveAttribute('aria-current', 'step');
    expect(rows[1]).not.toHaveAttribute('aria-current');
  });

  it('이 여행 기간에 다녀온 첫 Stop은 다녀온 곳으로, 카드는 2번째', async () => {
    await renderToday(withVisited(lib(), P1, '2026-10-24'));
    expect(cardHead('다음 · 2번째')).toBeInTheDocument();
    expect(cardTitle()).toHaveTextContent('안목 카페거리');
    expect(remainingRows()).toHaveLength(1);
    const toggle = screen.getByRole('button', { name: '다녀온 곳 1곳' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('다녀옴 · 10.24(토)')).not.toBeInTheDocument();
    await userEvent.setup().click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('다녀옴 · 10.24(토)')).toBeInTheDocument();
  });

  it('지난 여행에서 다녀온 날짜는 이번 여행의 다녀옴이 아니다', async () => {
    await renderToday(withVisited(lib(), P1, '2025-05-01'));
    expect(cardHead('다음 · 1번째')).toBeInTheDocument();
    expect(remainingRows()).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /^다녀온 곳/ })).not.toBeInTheDocument();
  });

  it('건너뛰고 뒤의 Stop을 다녀오면 앞의 Stop은 `지나침`', async () => {
    const three = lib({ stops: [[P1, P2, P5]] });
    await renderToday(withVisited(three, P2, '2026-10-24'));
    expect(cardHead('다음 · 3번째')).toBeInTheDocument();
    const rows = remainingRows();
    expect(rows[0]).toHaveTextContent('지나침');
    expect(rows[1]).toHaveAttribute('aria-current', 'step');
    expect(rows[1]).not.toHaveTextContent('지나침');
  });

  it('행 이름을 누르면 카드가 그 장소(`고른 장소`), `다음 장소 보기`로 돌아온다', async () => {
    await renderToday(lib());
    const user = userEvent.setup();
    await user.click(within(remainingList()).getByRole('button', { name: '2. 안목 카페거리' }));
    expect(cardHead('고른 장소 · 2번째')).toBeInTheDocument();
    expect(cardTitle()).toHaveTextContent('안목 카페거리');
    await user.click(within(nextCard()).getByRole('button', { name: '다음 장소 보기' }));
    expect(cardHead('다음 · 1번째')).toBeInTheDocument();
    expect(within(nextCard()).queryByRole('button', { name: '다음 장소 보기' })).toBeNull();
    // 포커스는 카드로 돌아간다.
    expect(nextCard()).toHaveFocus();
  });

  it('그날 Stop이 0곳이면 빈 상태와 계획 화면 링크', async () => {
    await renderToday(lib({ stops: [[], [P5]] }));
    expect(cardTitle()).toHaveTextContent('이 Day에는 일정이 없어요');
    expect(
      within(nextCard()).getByRole('link', { name: '계획 화면에서 장소 넣기' }),
    ).toHaveAttribute('href', `/trips/${TRIP}`);
    expect(screen.queryByRole('list', { name: '남은 일정' })).not.toBeInTheDocument();
  });

  it('모두 다녀왔고 숙소가 있으면 `마지막 · 숙소`', async () => {
    let all = lib({ lodging: [HOUSE] });
    all = withVisited(withVisited(all, P1, '2026-10-24'), P2, '2026-10-24');
    await renderToday(all);
    expect(cardHead('마지막 · 숙소')).toBeInTheDocument();
    expect(cardTitle()).toHaveTextContent('바다 숙소');
    expect(within(nextCard()).getByText(/^계획 도착 \d\d:\d\d$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다녀온 곳 2곳' })).toBeInTheDocument();
  });

  it('모두 다녀왔고 숙소가 없으면 `오늘 일정을 모두 다녀왔어요`', async () => {
    const all = withVisited(withVisited(lib(), P1, '2026-10-24'), P2, '2026-10-25');
    await renderToday(all);
    expect(cardTitle()).toHaveTextContent('오늘 일정을 모두 다녀왔어요');
    expect(within(nextCard()).queryByRole('button')).toBeNull();
  });
});

describe('당일 모드: 다른 Day·기간 밖', () => {
  it('메뉴에서 다른 Day를 고르면 띠와 `오늘로`, 오늘 Day 항목은 ` · 오늘`', async () => {
    await renderToday(lib());
    const user = userEvent.setup();
    const menuButton = screen.getByRole('button', { name: '오늘 일정 메뉴' });
    await user.click(menuButton);
    const today = screen.getByRole('menuitemradio', { name: 'Day 1 · 10.24(토) · 오늘' });
    expect(today).toHaveAttribute('aria-checked', 'true');
    const day2 = screen.getByRole('menuitemradio', { name: 'Day 2 · 10.25(일)' });
    expect(day2).toHaveAttribute('aria-checked', 'false');
    await user.click(day2);
    // 메뉴를 닫으면 포커스는 ⋯ 버튼으로 돌아간다.
    await waitFor(() => expect(menuButton).toHaveFocus());
    expect(screen.getByText('오늘이 아닌 Day 2를 보고 있어요')).toBeInTheDocument();
    expect(subtitle('강릉 여행 · Day 2 · 10.25(일)')).toBeInTheDocument();
    expect(cardTitle()).toHaveTextContent('창가 자리');

    await user.click(screen.getByRole('button', { name: '오늘로' }));
    expect(subtitle('강릉 여행 · Day 1 · 10.24(토)')).toBeInTheDocument();
    expect(screen.queryByText(/^오늘이 아닌 Day/)).not.toBeInTheDocument();
    expect(cardTitle()).toHaveTextContent('중앙시장 닭강정');
  });

  it('시작 전날에는 Day 1을 미리 보이고 띠로 알린다', async () => {
    vi.setSystemTime(new Date(2026, 9, 23, 12, 0));
    await renderToday(lib());
    expect(
      screen.getByText('여행은 내일(10.24(토)) 시작해요. Day 1을 미리 보여 드려요'),
    ).toBeInTheDocument();
    expect(subtitle('강릉 여행 · Day 1 · 10.24(토)')).toBeInTheDocument();
  });

  it('며칠 전이면 `N일 뒤`', async () => {
    vi.setSystemTime(new Date(2026, 9, 20, 12, 0));
    await renderToday(lib());
    expect(
      screen.getByText('여행은 4일 뒤(10.24(토)) 시작해요. Day 1을 미리 보여 드려요'),
    ).toBeInTheDocument();
  });

  it('끝난 뒤에는 마지막 Day를 보이고 띠로 알린다', async () => {
    vi.setSystemTime(new Date(2026, 9, 27, 12, 0));
    await renderToday(lib());
    expect(
      screen.getByText('여행이 끝났어요(10.26(월)). 마지막 Day를 보여 드려요'),
    ).toBeInTheDocument();
    expect(subtitle('강릉 여행 · Day 3 · 10.26(월)')).toBeInTheDocument();
    // 기간 밖에는 오늘 Day가 없다.
    await userEvent.setup().click(screen.getByRole('button', { name: '오늘 일정 메뉴' }));
    expect(screen.queryByRole('menuitemradio', { name: / · 오늘$/ })).not.toBeInTheDocument();
  });
});

describe('당일 모드: 그날 장소가 다른 곳에서 지워짐', () => {
  it('카드가 보던 장소가 지워지면 다음 장소로, 그날 Stop이 모두 지워지면 빈 상태', async () => {
    const { store } = await renderToday(lib());
    const user = userEvent.setup();
    await user.click(within(remainingList()).getByRole('button', { name: '2. 안목 카페거리' }));
    expect(cardHead('고른 장소 · 2번째')).toBeInTheDocument();

    act(() => store.set(libraryAtom, withDeleted(store.get(libraryAtom), P2)));
    expect(cardHead('다음 · 1번째')).toBeInTheDocument();
    expect(cardTitle()).toHaveTextContent('중앙시장 닭강정');
    expect(remainingRows()).toHaveLength(1);

    act(() => store.set(libraryAtom, withDeleted(store.get(libraryAtom), P1)));
    expect(cardTitle()).toHaveTextContent('이 Day에는 일정이 없어요');
  });

  it('고른 장소보다 앞의 장소가 지워져도 카드는 같은 장소를 보인다', async () => {
    const { store } = await renderToday(lib({ stops: [[P1, P2, P5]] }));
    const user = userEvent.setup();
    await user.click(within(remainingList()).getByRole('button', { name: '3. 창가 자리' }));
    act(() => store.set(libraryAtom, withDeleted(store.get(libraryAtom), P1)));
    expect(cardHead('고른 장소 · 2번째')).toBeInTheDocument();
    expect(cardTitle()).toHaveTextContent('창가 자리');
  });
});

describe('당일 모드: 배치', () => {
  const leftPane = () => nextCard().closest('[data-today-pane]') as HTMLElement;
  const map = () => screen.getByRole('region', { name: '지도' });

  it('넓은 화면은 왼쪽 칸(360px)과 지도가 나란히', async () => {
    await renderToday(lib(), { width: 1280 });
    expect(getComputedStyle(leftPane()).width).toBe('360px');
    expect(leftPane().contains(map())).toBe(false);
    // 왼쪽 칸이 지도보다 앞에 있다.
    expect(
      leftPane().compareDocumentPosition(map()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(leftPane().parentElement).toBe(map().parentElement);
  });

  it('좁은 화면은 지도가 위, 그 아래 카드·목록', async () => {
    await renderToday(lib(), { width: 390 });
    expect(
      map().compareDocumentPosition(nextCard()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(getComputedStyle(map()).height).toBe('clamp(180px, 34dvh, 320px)');
  });
});

describe('당일 모드: 지도 핀', () => {
  let resources: ReturnType<typeof installMapResources>;
  beforeEach(() => {
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    resources = installMapResources();
  });
  afterEach(() => resources.restore());

  const marker = (id: string) => screen.getByTestId(`marker-${id}`);

  it('다녀온 Stop의 핀은 흐리게, 핀을 누르면 그 장소를 카드에, 출발점·숙소 핀은 무시', async () => {
    await renderToday(withVisited(lib({ origin: HOUSE, stops: [[P1, P2, P5]] }), P1, '2026-10-24'));
    await waitFor(() => expect(screen.getByTestId('fake-map')).toBeInTheDocument());
    await waitFor(() => expect(marker(P1)).toBeInTheDocument());
    expect(marker(P1)).toHaveAttribute('data-dimmed', 'true');
    expect(marker(P2)).not.toHaveAttribute('data-dimmed');
    expect(marker(`start:${HOUSE}`)).not.toHaveAttribute('data-dimmed');

    const user = userEvent.setup();
    await user.click(marker(P5));
    expect(cardHead('고른 장소 · 3번째')).toBeInTheDocument();
    await user.click(marker(`start:${HOUSE}`));
    expect(cardHead('고른 장소 · 3번째')).toBeInTheDocument();
  });
});
