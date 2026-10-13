import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import { LIBRARY_KEY } from 'src/services/library-store';
import { dropAction } from 'src/sections/trips/planner/PlannerDnd';
import { movedMessage } from 'src/sections/trips/planner/stop-ops';
import { libraryAtom } from 'src/stores/library-state';
import {
  f,
  makeTrip,
  open,
  P1,
  P2,
  P3,
  P5,
  plannerLibrary,
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
  vi.restoreAllMocks();
});

// ---------- 도우미 ----------

type Opened = Awaited<ReturnType<typeof open>>;

const trip = (store: Opened['store']) => store.get(libraryAtom).trips[TRIP]!;
const dayPlaces = (store: Opened['store'], d: number) =>
  trip(store).days[d]!.stops.value.map((s) => s.placeId);
const stored = (storage: Storage) => JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library;

/** 다른 탭이 쓴 것처럼 저장소의 문서를 직접 고친다. 이 탭의 화면은 모른다. */
function writeAsOtherTab(storage: Storage, edit: (lib: Library) => Library) {
  storage.setItem(LIBRARY_KEY, JSON.stringify(edit(stored(storage))));
}

/** 다른 탭의 시각. 이 탭의 연산 시각(가짜 시계)과 다르다. */
const OTHER_TAB_AT = '2026-10-13T03:00:30.000Z';

type ToastOptions = { duration?: number; action?: { label: string; onClick(): void } };

/** `message`로 띄운 마지막 토스트의 옵션. */
function lastToast(message: string): ToastOptions {
  const call = toastMock.mock.calls.findLast((c) => c[0] === message);
  expect(call, `토스트 '${message}'`).toBeDefined();
  return (call![1] ?? {}) as ToastOptions;
}

async function undo(message: string) {
  const options = lastToast(message);
  expect(options.action?.label).toBe('되돌리기');
  expect(options.duration).toBe(8000);
  await act(async () => {
    options.action!.onClick();
  });
}

const panel = () => screen.getByRole('region', { name: '후보 칸' });

async function openRowMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: `${name} 메뉴` }));
  return screen.getByRole('menu');
}

/**
 * jsdom은 배치를 하지 않는다. dnd-kit이 키보드로 옮길 자리를 찾도록 사각형을 준다.
 * - 후보 칸: 왼쪽(x 0–360, y 100–700), 후보 행은 y 200부터 56px씩
 * - 시간표 행: 오른쪽(x 400–760), y 200부터 56px씩(구간 행도 한 줄)
 * - Day 탭: 시간표 위(y 0–48), x 400부터 360px씩(탭 줄은 모두 담는 너비)
 * - 끌기 겹(DragOverlay): 지금 초점이 있는 손잡이의 행
 */
function stubLayout() {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({
      x: left,
      y: top,
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      toJSON: () => ({}),
    }) as DOMRect;
  const indexIn = (el: Element, selector: string) =>
    [...el.parentElement!.children].filter((c) => c.matches(selector)).indexOf(el);
  const layout = (el: Element): DOMRect => {
    if (el.closest('[data-drag-overlay]')) {
      const focused = document.activeElement;
      return focused && focused !== document.body ? layout(focused) : rect(0, 0, 0, 0);
    }
    const item = el.closest('li');
    if (item) {
      const top = 200 + indexIn(item, 'li') * 56;
      return item.closest('[aria-label="후보 칸"]')
        ? rect(0, top, 360, 56)
        : rect(400, top, 360, 56);
    }
    const tab = el.closest('[role="tab"]');
    if (tab) return rect(400 + indexIn(tab, '[role="tab"]') * 360, 0, 360, 48);
    // 탭 줄은 탭을 모두 담을 만큼 넓다(MUI가 고른 탭을 보이려고 가로 스크롤하지 않게).
    if (el.closest('.MuiTabs-root')) return rect(400, 0, 3600, 48);
    if (el.closest('[aria-label="후보 칸"]')) return rect(0, 100, 360, 600);
    return rect(0, 0, 0, 0);
  };
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return layout(this);
  });
}

async function keyboardDrag(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  keys: string[],
) {
  screen.getByRole('button', { name: `${name} 끌어 옮기기` }).focus();
  await user.keyboard(' ');
  for (const key of keys) await user.keyboard(`{${key}}`);
  await user.keyboard(' ');
}

// ---------- 행 메뉴 ----------

describe('시간표 행 메뉴', () => {
  it('위로·아래로는 한 칸씩 옮기고, 맨 위·맨 아래에서는 꺼져 있다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P5, P2]] }));
    const { store, storage } = await open(lib);
    const user = userEvent.setup();

    let menu = await openRowMenu(user, '창가 자리');
    await user.click(within(menu).getByRole('menuitem', { name: '위로' }));
    await waitFor(() => expect(dayPlaces(store, 0)).toEqual([P5, P1, P2]));
    expect(lastToast('Day 1로 옮겼어요').action?.label).toBe('되돌리기');

    menu = await openRowMenu(user, '창가 자리');
    expect(within(menu).getByRole('menuitem', { name: '위로' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.click(within(menu).getByRole('menuitem', { name: '아래로' }));
    await waitFor(() => expect(dayPlaces(store, 0)).toEqual([P1, P5, P2]));

    menu = await openRowMenu(user, '안목 카페거리');
    expect(within(menu).getByRole('menuitem', { name: '아래로' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.keyboard('{Escape}');
    expect(stored(storage).trips[TRIP]!.days[0]!.stops.value.map((s) => s.placeId)).toEqual([
      P1,
      P5,
      P2,
    ]);
  });

  it('다른 Day로: 고른 Day의 끝으로 옮긴다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ days: 3, stops: [[P1, P5], [P2]] }));
    const { store } = await open(lib);
    const user = userEvent.setup();

    const menu = await openRowMenu(user, '중앙시장 닭강정');
    await user.click(within(menu).getByRole('menuitem', { name: '다른 Day로' }));
    const days = screen.getByRole('menu');
    expect(
      within(days)
        .getAllByRole('menuitem')
        .map((el) => el.textContent),
    ).toEqual(['Day 2 10.24(토)', 'Day 3 10.25(일)']);
    await user.click(within(days).getByRole('menuitem', { name: 'Day 2 10.24(토)' }));

    await waitFor(() => expect(dayPlaces(store, 1)).toEqual([P2, P1]));
    expect(dayPlaces(store, 0)).toEqual([P5]);
    expect(lastToast('Day 2로 옮겼어요').duration).toBe(8000);
  });

  it('후보로 빼기: Day에서 빠져 후보 끝으로 간다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P5]], candidates: [P3] }));
    const { store } = await open(lib);
    const user = userEvent.setup();

    const menu = await openRowMenu(user, '중앙시장 닭강정');
    await user.click(within(menu).getByRole('menuitem', { name: '후보로 빼기' }));
    await waitFor(() => expect(trip(store).candidates.value).toEqual([P3, P1]));
    expect(dayPlaces(store, 0)).toEqual([P5]);
    expect(lastToast('후보로 뺐어요').action?.label).toBe('되돌리기');
  });
});

describe('후보 행 메뉴', () => {
  it('Day N에 넣기는 지금 Day 끝에, 후보에서 빼기는 여행에서 뺀다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1]], candidates: [P3, P2] }));
    const { store } = await open(lib, { ids: ['stopaaaa'] });
    const user = userEvent.setup();

    let menu = await openRowMenu(user, '속초 횟집');
    await user.click(within(menu).getByRole('menuitem', { name: 'Day 1에 넣기' }));
    await waitFor(() => expect(dayPlaces(store, 0)).toEqual([P1, P3]));
    expect(lastToast('Day 1에 넣었어요').action?.label).toBe('되돌리기');

    menu = await openRowMenu(user, '안목 카페거리');
    await user.click(within(menu).getByRole('menuitem', { name: '후보에서 빼기' }));
    await waitFor(() => expect(trip(store).candidates.value).toEqual([]));
    expect(within(panel()).getByText('후보 0')).toBeInTheDocument();

    // 여행에서 뺀 것도 되돌린다.
    await undo('후보에서 뺐어요');
    await waitFor(() => expect(trip(store).candidates.value).toEqual([P2]));
  });

  it('＋도 되돌리기 토스트를 띄운다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ candidates: [P1] }));
    const { store } = await open(lib, { ids: ['stopaaaa'] });
    const user = userEvent.setup();
    await user.click(within(panel()).getByRole('button', { name: /Day 1에 넣기$/ }));
    await waitFor(() => expect(dayPlaces(store, 0)).toEqual([P1]));
    await undo('Day 1에 넣었어요');
    await waitFor(() => expect(trip(store).candidates.value).toEqual([P1]));
    expect(dayPlaces(store, 0)).toEqual([]);
  });
});

// ---------- 끌어 옮기기 ----------

describe('끌어 옮기기(키보드)', () => {
  it('끌기 손잡이는 한국어 역할 설명(`옮길 수 있는 항목`)을 읽는다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P5]], candidates: [P2] }));
    await open(lib);
    const handles = screen.getAllByRole('button', { name: /끌어 옮기기$/ });
    expect(handles.length).toBeGreaterThanOrEqual(3);
    for (const handle of handles) {
      expect(handle).toHaveAttribute('aria-roledescription', '옮길 수 있는 항목');
    }
  });

  it('스페이스 → 아래 화살표 → 스페이스로 시간표 안 순서를 바꾼다', async () => {
    stubLayout();
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P5, P2]] }));
    const { store, storage } = await open(lib);
    const user = userEvent.setup();

    await keyboardDrag(user, '중앙시장 닭강정', ['ArrowDown']);
    await waitFor(() => expect(dayPlaces(store, 0)).toEqual([P5, P1, P2]));
    expect(stored(storage).trips[TRIP]!.days[0]!.stops.value.map((s) => s.placeId)).toEqual([
      P5,
      P1,
      P2,
    ]);
    expect(lastToast('Day 1로 옮겼어요').action?.label).toBe('되돌리기');
  });

  it('Esc로 끌기를 그만두면 아무것도 바꾸지 않는다', async () => {
    stubLayout();
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P5, P2]] }));
    const { store } = await open(lib);
    const user = userEvent.setup();

    screen.getByRole('button', { name: '중앙시장 닭강정 끌어 옮기기' }).focus();
    await user.keyboard(' ');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Escape}');
    expect(dayPlaces(store, 0)).toEqual([P1, P5, P2]);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('후보 행을 시간표의 행 자리로 끌면 그 자리에 넣는다', async () => {
    stubLayout();
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P5]], candidates: [P3] }));
    const { store } = await open(lib, { ids: ['stopaaaa'] });
    const user = userEvent.setup();

    await keyboardDrag(user, '속초 횟집', ['ArrowRight']);
    await waitFor(() => expect(dayPlaces(store, 0)).toEqual([P3, P1, P5]));
    expect(trip(store).candidates.value).toEqual([]);
    expect(lastToast('Day 1에 넣었어요').action?.label).toBe('되돌리기');
  });

  it('시간표 행을 후보 칸으로 끌면 후보로 뺀다', async () => {
    stubLayout();
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P5]] }));
    const { store } = await open(lib);
    const user = userEvent.setup();

    await keyboardDrag(user, '창가 자리', ['ArrowLeft']);
    await waitFor(() => expect(trip(store).candidates.value).toEqual([P5]));
    expect(dayPlaces(store, 0)).toEqual([P1]);
    expect(lastToast('후보로 뺐어요').action?.label).toBe('되돌리기');
  });

  it('시간표 행을 다른 Day 탭으로 끌면 그 Day 끝으로 옮긴다', async () => {
    stubLayout();
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P5], [P2]] }));
    const { store } = await open(lib);
    const user = userEvent.setup();

    await keyboardDrag(user, '중앙시장 닭강정', ['ArrowUp', 'ArrowRight']);
    await waitFor(() => expect(dayPlaces(store, 1)).toEqual([P2, P1]));
    expect(dayPlaces(store, 0)).toEqual([P5]);
    expect(lastToast('Day 2로 옮겼어요').action?.label).toBe('되돌리기');
  });
});

// ---------- 되돌리기 ----------

describe('되돌리기', () => {
  it('되돌리기를 누르면 연산 전 값으로 돌아간다', async () => {
    stubLayout();
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P5, P2]] }));
    const { store, storage } = await open(lib);
    const user = userEvent.setup();

    await keyboardDrag(user, '중앙시장 닭강정', ['ArrowDown']);
    await waitFor(() => expect(dayPlaces(store, 0)).toEqual([P5, P1, P2]));
    await undo('Day 1로 옮겼어요');
    await waitFor(() => expect(dayPlaces(store, 0)).toEqual([P1, P5, P2]));
    expect(stored(storage).trips[TRIP]!.days[0]!.stops.value.map((s) => s.placeId)).toEqual([
      P1,
      P5,
      P2,
    ]);
    expect(toastMock).not.toHaveBeenCalledWith('다른 곳에서 바뀐 부분은 그대로 두었어요');
  });

  it('다른 탭이 그사이 다른 Day를 바꿨으면 되돌린 Day만 이전 값이고 다른 Day는 그대로다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P5], [P2]], candidates: [P3] }));
    const { store, storage } = await open(lib);
    const user = userEvent.setup();

    const menu = await openRowMenu(user, '중앙시장 닭강정');
    await user.click(within(menu).getByRole('menuitem', { name: '아래로' }));
    await waitFor(() => expect(dayPlaces(store, 0)).toEqual([P5, P1]));

    // 다른 탭: 후보의 속초 횟집을 Day 2 앞에 넣었다.
    writeAsOtherTab(storage, (doc) => {
      const t = doc.trips[TRIP]!;
      const day2 = t.days[1]!;
      const stop = { id: 'stopothr', placeId: P3, stayMin: null, fixedTime: null, note: '' };
      const days = t.days.map((d, i) =>
        i === 1
          ? { ...d, stops: { value: [stop, ...day2.stops.value], updatedAt: OTHER_TAB_AT } }
          : d,
      );
      const candidates = { value: [], updatedAt: OTHER_TAB_AT };
      return { ...doc, trips: { ...doc.trips, [TRIP]: { ...t, days, candidates } } };
    });

    await undo('Day 1로 옮겼어요');
    await waitFor(() => expect(dayPlaces(store, 0)).toEqual([P1, P5]));
    expect(dayPlaces(store, 1)).toEqual([P3, P2]);
    expect(trip(store).candidates.value).toEqual([]);
    const saved = stored(storage).trips[TRIP]!;
    expect(saved.days[0]!.stops.value.map((s) => s.placeId)).toEqual([P1, P5]);
    expect(saved.days[1]!.stops.value.map((s) => s.placeId)).toEqual([P3, P2]);
    expect(toastMock).not.toHaveBeenCalledWith('다른 곳에서 바뀐 부분은 그대로 두었어요');
  });

  it('다른 탭이 같은 필드를 바꿨으면 그 필드는 그대로 두고 알린다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P5, P2]] }));
    const { store, storage } = await open(lib);
    const user = userEvent.setup();

    const menu = await openRowMenu(user, '중앙시장 닭강정');
    await user.click(within(menu).getByRole('menuitem', { name: '아래로' }));
    await waitFor(() => expect(dayPlaces(store, 0)).toEqual([P5, P1, P2]));

    // 다른 탭: 같은 Day 1의 순서를 또 바꿨다.
    writeAsOtherTab(storage, (doc) => {
      const t = doc.trips[TRIP]!;
      const day1 = t.days[0]!;
      const reversed = [...day1.stops.value].reverse();
      const days = t.days.map((d, i) =>
        i === 0 ? { ...d, stops: { ...f(reversed), updatedAt: OTHER_TAB_AT } } : d,
      );
      return { ...doc, trips: { ...doc.trips, [TRIP]: { ...t, days } } };
    });

    await undo('Day 1로 옮겼어요');
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith('다른 곳에서 바뀐 부분은 그대로 두었어요'),
    );
    expect(dayPlaces(store, 0)).toEqual([P2, P1, P5]);
    expect(stored(storage).trips[TRIP]!.days[0]!.stops.value.map((s) => s.placeId)).toEqual([
      P2,
      P1,
      P5,
    ]);
  });
});

describe('문구와 놓을 곳', () => {
  it('옮기기 문구는 Day 번호의 받침에 맞춰 로/으로를 쓴다', () => {
    expect(movedMessage(0)).toBe('Day 1로 옮겼어요');
    expect(movedMessage(1)).toBe('Day 2로 옮겼어요');
    expect(movedMessage(2)).toBe('Day 3으로 옮겼어요');
    expect(movedMessage(6)).toBe('Day 7로 옮겼어요');
    expect(movedMessage(9)).toBe('Day 10으로 옮겼어요');
  });

  it('제자리·자기 Day 탭·후보끼리는 할 일이 없다', () => {
    const stop = { kind: 'stop', stopId: 'stop0000', placeId: P1, dayIndex: 0, name: 'a' } as const;
    const cand = { kind: 'candidate', placeId: P3, name: 'b' } as const;
    expect(dropAction(TRIP, stop, { ...stop })).toBeNull();
    expect(dropAction(TRIP, stop, { kind: 'day', dayIndex: 0 })).toBeNull();
    expect(dropAction(TRIP, cand, { kind: 'candidates' })).toBeNull();
    expect(dropAction(TRIP, cand, { ...cand })).toBeNull();
    expect(dropAction(TRIP, stop, undefined)).toBeNull();
    expect(dropAction(TRIP, stop, { kind: 'day', dayIndex: 1 })?.message).toBe('Day 2로 옮겼어요');
    expect(dropAction(TRIP, stop, { kind: 'day-end', dayIndex: 0 })?.message).toBe(
      'Day 1로 옮겼어요',
    );
  });
});
