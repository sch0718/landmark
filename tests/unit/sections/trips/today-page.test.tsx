import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visitedOnOf } from 'src/domain/library/visit';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import { LIBRARY_KEY } from 'src/services/library-store';
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
  slowLocks,
  todayTrip,
  TRIP,
  withDeleted,
  withTrip,
  withVisited,
} from './today-fixtures';

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
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  toastMock.mockClear();
  toastMock.error.mockClear();
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

describe('당일 모드: 다녀옴 체크', () => {
  type ToastOptions = { duration: number; action: { label: string; onClick: () => void } };
  /** 이 문구로 띄운 마지막 토스트의 옵션. */
  const toastOf = (message: string): ToastOptions | undefined =>
    toastMock.mock.calls.findLast((c) => c[0] === message)?.[1] as ToastOptions | undefined;
  const checkbox = (name: string) => screen.getByRole('checkbox', { name: `‘${name}’ 다녀옴` });
  const storedVisited = (storage: Storage, id: string) =>
    visitedOnOf((JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library).places[id]!);
  const shownVisited = (store: { get: (atom: typeof libraryAtom) => Library }, id: string) =>
    visitedOnOf(store.get(libraryAtom).places[id]!);
  /** 다른 탭이 저장소와 화면 문서에 다녀온 날을 적은 것처럼 흉내 낸다. */
  const otherTabSets = (
    storage: Storage,
    store: {
      get: (atom: typeof libraryAtom) => Library;
      set: (a: typeof libraryAtom, v: Library) => void;
    },
    id: string,
    value: string | null,
  ) => {
    const field = { value, updatedAt: '2099-01-01T00:00:00.000Z' };
    const edit = (lib: Library): Library => ({
      ...lib,
      places: { ...lib.places, [id]: { ...lib.places[id]!, visitedOn: field } },
    });
    storage.setItem(LIBRARY_KEY, JSON.stringify(edit(JSON.parse(storage.getItem(LIBRARY_KEY)!))));
    act(() => store.set(libraryAtom, edit(store.get(libraryAtom))));
  };
  const undoToast = async (message: string) => {
    const options = toastOf(message);
    expect(options?.action.label).toBe('되돌리기');
    await act(async () => {
      options!.action.onClick();
    });
  };

  it('남은 일정의 체크 상자로 체크하면 토스트·다음 장소·다녀온 곳, 되돌리기는 옛 날짜로', async () => {
    const { store, storage } = await renderToday(withVisited(lib(), P1, '2025-05-01'));
    const user = userEvent.setup();
    const box = checkbox('중앙시장 닭강정');
    expect(box).not.toBeChecked();
    expect(getComputedStyle(box.parentElement!).width).toBe('44px');
    await user.click(box);

    await waitFor(() => expect(storedVisited(storage, P1)).toBe('2026-10-24'));
    const message = '‘중앙시장 닭강정’ 다녀옴으로 표시했어요';
    expect(toastOf(message)?.duration).toBe(8000);
    expect(cardHead('다음 · 2번째')).toBeInTheDocument();
    expect(cardTitle()).toHaveTextContent('안목 카페거리');
    expect(remainingRows()).toHaveLength(1);
    expect(screen.getByRole('button', { name: '다녀온 곳 1곳' })).toBeInTheDocument();

    await undoToast(message);
    await waitFor(() => expect(storedVisited(storage, P1)).toBe('2025-05-01'));
    expect(shownVisited(store, P1)).toBe('2025-05-01');
    expect(cardHead('다음 · 1번째')).toBeInTheDocument();
    expect(toastMock).not.toHaveBeenCalledWith('다른 곳에서 바뀐 부분은 그대로 두었어요');
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('다녀온 곳의 체크 상자로 풀면 토스트, 되돌리기는 지운 날짜로', async () => {
    const { storage } = await renderToday(withVisited(lib(), P1, '2026-10-24'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '다녀온 곳 1곳' }));
    const box = within(screen.getByRole('list', { name: '다녀온 곳' })).getByRole('checkbox', {
      name: '‘중앙시장 닭강정’ 다녀옴',
    });
    expect(box).toBeChecked();
    await user.click(box);

    await waitFor(() => expect(storedVisited(storage, P1)).toBeNull());
    const message = '‘중앙시장 닭강정’ 다녀옴 표시를 지웠어요';
    expect(toastOf(message)?.duration).toBe(8000);
    expect(cardHead('다음 · 1번째')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^다녀온 곳/ })).not.toBeInTheDocument();

    await undoToast(message);
    await waitFor(() => expect(storedVisited(storage, P1)).toBe('2026-10-24'));
    expect(cardHead('다음 · 2번째')).toBeInTheDocument();
  });

  it('카드의 `다녀옴`도 같고, 새벽 01:30에는 오늘 Day(어제)의 날짜를 쓴다', async () => {
    vi.setSystemTime(new Date(2026, 9, 25, 1, 30));
    const { storage } = await renderToday(lib());
    const user = userEvent.setup();
    await user.click(
      within(nextCard()).getByRole('button', { name: '‘중앙시장 닭강정’ 다녀옴으로 표시' }),
    );
    await waitFor(() => expect(storedVisited(storage, P1)).toBe('2026-10-24'));
    expect(toastOf('‘중앙시장 닭강정’ 다녀옴으로 표시했어요')?.duration).toBe(8000);
    expect(cardTitle()).toHaveTextContent('안목 카페거리');
  });

  it('기간 밖에는 체크 상자도 `다녀옴`도 없다', async () => {
    vi.setSystemTime(new Date(2026, 9, 23, 12, 0));
    await renderToday(withVisited(lib(), P2, '2026-10-24'));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(nextCard()).queryByRole('button', { name: /다녀옴으로 표시$/ })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: '다녀온 곳 1곳' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('다른 Day에서도 체크할 수 있고, 날짜는 오늘 Day의 날짜다', async () => {
    const { storage } = await renderToday(lib());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '오늘 일정 메뉴' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Day 2 · 10.25(일)' }));
    await user.click(checkbox('창가 자리'));
    await waitFor(() => expect(storedVisited(storage, P5)).toBe('2026-10-24'));
    expect(screen.getByRole('button', { name: '다녀온 곳 1곳' })).toBeInTheDocument();
  });

  it('고른 장소를 체크하면 카드가 다음 장소로 돌아온다', async () => {
    await renderToday(lib({ stops: [[P1, P2, P5]] }));
    const user = userEvent.setup();
    await user.click(within(remainingList()).getByRole('button', { name: '2. 안목 카페거리' }));
    expect(cardHead('고른 장소 · 2번째')).toBeInTheDocument();
    await user.click(
      within(nextCard()).getByRole('button', { name: '‘안목 카페거리’ 다녀옴으로 표시' }),
    );
    await waitFor(() => expect(cardHead('다음 · 3번째')).toBeInTheDocument());
    expect(cardTitle()).toHaveTextContent('창가 자리');
    expect(remainingRows()[0]).toHaveTextContent('지나침');
  });

  it('저장이 끝나기 전에 두 번 눌러도 저장은 한 번이고, 그동안 상자·버튼은 꺼진다', async () => {
    const slow = slowLocks();
    const { storage } = await renderToday(lib(), { libraryLocks: slow.locks });
    const user = userEvent.setup();
    const before = slow.requests;
    slow.hold();
    const box = checkbox('중앙시장 닭강정');
    await user.click(box);
    await waitFor(() => expect(box).toBeDisabled());
    expect(
      within(nextCard()).getByRole('button', { name: '‘중앙시장 닭강정’ 다녀옴으로 표시' }),
    ).toBeDisabled();
    fireEvent.click(box);
    fireEvent.click(
      within(nextCard()).getByRole('button', { name: '‘중앙시장 닭강정’ 다녀옴으로 표시' }),
    );
    expect(storedVisited(storage, P1)).toBeNull();

    await act(async () => slow.release());
    await waitFor(() => expect(storedVisited(storage, P1)).toBe('2026-10-24'));
    expect(slow.requests - before).toBe(1);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '다녀온 곳 1곳' })).toBeInTheDocument();
  });

  it('되돌리기 전에 다른 곳이 값을 바꿨으면 바꾸지 않고 알린다', async () => {
    const { store, storage } = await renderToday(withVisited(lib(), P1, '2025-05-01'));
    const user = userEvent.setup();
    await user.click(checkbox('중앙시장 닭강정'));
    await waitFor(() => expect(storedVisited(storage, P1)).toBe('2026-10-24'));

    otherTabSets(storage, store, P1, null); // 다른 탭이 풀었다.
    await undoToast('‘중앙시장 닭강정’ 다녀옴으로 표시했어요');
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith('다른 곳에서 바뀐 부분은 그대로 두었어요'),
    );
    expect(storedVisited(storage, P1)).toBeNull();
    expect(shownVisited(store, P1)).toBeNull();
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});

describe('당일 모드: 지도는 사람이 고를 때만 옮긴다', () => {
  let resources: ReturnType<typeof installMapResources>;
  beforeEach(() => {
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    resources = installMapResources();
  });
  afterEach(() => resources.restore());

  const fakeMap = () => screen.getByTestId('fake-map');
  // 지도 여백이 사방 같아서(40px) 옮긴 중심은 장소 좌표 그대로다.
  const centeredAt = (lng: number, lat: number) => {
    expect(fakeMap()).toHaveAttribute('data-center', `${lng},${lat}`);
    expect(fakeMap()).toHaveAttribute('data-zoom', '16');
  };

  it('행을 누르면 옮기고, 체크로 카드가 다음 장소로 넘어가도 옮기지 않는다', async () => {
    await renderToday(lib({ stops: [[P1, P2, P5]] }));
    await waitFor(() => expect(screen.getByTestId(`marker-${P1}`)).toBeInTheDocument());
    expect(fakeMap()).not.toHaveAttribute('data-center');

    const user = userEvent.setup();
    await user.click(within(remainingList()).getByRole('button', { name: '2. 안목 카페거리' }));
    await waitFor(() => centeredAt(128.947, 37.772));

    await user.click(
      within(nextCard()).getByRole('button', { name: '‘안목 카페거리’ 다녀옴으로 표시' }),
    );
    await waitFor(() => expect(cardTitle()).toHaveTextContent('창가 자리'));
    centeredAt(128.947, 37.772);

    // `다음 장소 보기`로 돌아오면 다음 장소로 옮긴다.
    await user.click(within(remainingList()).getByRole('button', { name: '1. 중앙시장 닭강정' }));
    await waitFor(() => centeredAt(128.9, 37.75));
    await user.click(within(nextCard()).getByRole('button', { name: '다음 장소 보기' }));
    await waitFor(() => centeredAt(128.905, 37.75));
  });

  it('체크로 다음 장소가 바뀌어도 처음 맞춘 지도를 옮기지 않는다', async () => {
    await renderToday(lib());
    await waitFor(() => expect(screen.getByTestId(`marker-${P1}`)).toBeInTheDocument());
    await userEvent
      .setup()
      .click(screen.getByRole('checkbox', { name: '‘중앙시장 닭강정’ 다녀옴' }));
    await waitFor(() => expect(cardTitle()).toHaveTextContent('안목 카페거리'));
    expect(fakeMap()).not.toHaveAttribute('data-center');
    expect(fakeMap()).not.toHaveAttribute('data-zoom');
  });
});
