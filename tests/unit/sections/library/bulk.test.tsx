import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import { LIBRARY_KEY } from 'src/services/library-store';
import { libraryAtom } from 'src/stores/library-state';
import { L_CAFE, L_FOOD, makePlace, renderLibrary, sampleLibrary } from './fixtures';

const toastMock = vi.hoisted(() => {
  const error = vi.fn();
  return Object.assign(vi.fn(), { error });
});
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  toastMock.mockClear();
  toastMock.error.mockClear();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

const LIST = { libraryView: 'list' as const };
const row = (name: RegExp) =>
  within(screen.getByRole('list', { name: '장소 목록' })).getByRole('button', { name });
const toolbar = () => screen.getByRole('toolbar', { name: '일괄 편집' });
const labelsOf = (lib: Library, id: string) => lib.places[id]!.labelIds.value;

async function shiftClick(user: ReturnType<typeof userEvent.setup>, ...names: RegExp[]) {
  await user.keyboard('{Shift>}');
  for (const name of names) await user.click(row(name));
  await user.keyboard('{/Shift}');
}

describe('library bulk edit', () => {
  it('shift-click enters selection; bulk add label applies to all selected', async () => {
    const user = userEvent.setup();
    const { store, storage, router } = await renderLibrary(sampleLibrary(), { prefs: LIST });
    expect(screen.queryByRole('toolbar', { name: '일괄 편집' })).not.toBeInTheDocument();

    await shiftClick(user, /창가 자리/, /강남 한 곳/);
    expect(router.state.location.pathname).toBe('/'); // 열지 않고 선택만 했다.
    expect(within(toolbar()).getByText('2곳 선택')).toBeInTheDocument();
    expect(row(/창가 자리/)).toHaveAttribute('aria-pressed', 'true');
    expect(row(/안목 카페거리/)).toHaveAttribute('aria-pressed', 'false');

    // 선택 모드에서는 Shift 없이 눌러도 선택이 바뀐다.
    await user.click(row(/안목 카페거리/));
    expect(within(toolbar()).getByText('3곳 선택')).toBeInTheDocument();
    await user.click(row(/안목 카페거리/));
    expect(within(toolbar()).getByText('2곳 선택')).toBeInTheDocument();

    await user.click(within(toolbar()).getByRole('button', { name: '라벨 붙이기' }));
    await user.click(screen.getByRole('menuitem', { name: '카페' }));

    await waitFor(() => {
      const lib = store.get(libraryAtom);
      expect(labelsOf(lib, 'place00005')).toEqual([L_CAFE]);
      expect(labelsOf(lib, 'place00004')).toEqual([L_CAFE]);
    });
    expect(labelsOf(store.get(libraryAtom), 'place00001')).toEqual([L_FOOD]); // 선택하지 않은 장소는 그대로.
    expect(JSON.parse(storage.getItem(LIBRARY_KEY)!).places.place00005.labelIds.value).toEqual([
      L_CAFE,
    ]);
    // 라벨 작업 뒤에도 선택은 남는다.
    expect(within(toolbar()).getByText('2곳 선택')).toBeInTheDocument();

    await user.click(within(toolbar()).getByRole('button', { name: '선택 해제' }));
    expect(screen.queryByRole('toolbar', { name: '일괄 편집' })).not.toBeInTheDocument();
  });

  it('long-press (500ms) enters selection', async () => {
    const { router } = await renderLibrary(sampleLibrary(), { prefs: LIST });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    // 500ms 전에 떼면 길게 누르기가 아니라서 선택되지 않는다.
    const short = row(/안목 카페거리/);
    fireEvent.pointerDown(short, { button: 0 });
    act(() => void vi.advanceTimersByTime(400));
    fireEvent.pointerUp(short);
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.queryByRole('toolbar', { name: '일괄 편집' })).not.toBeInTheDocument();

    const target = row(/창가 자리/);
    fireEvent.pointerDown(target, { button: 0 });
    act(() => void vi.advanceTimersByTime(500));
    fireEvent.pointerUp(target);
    // 손을 뗄 때 이어지는 클릭은 열기로 이어지지 않는다.
    fireEvent.click(target);

    expect(within(toolbar()).getByText('1곳 선택')).toBeInTheDocument();
    expect(row(/창가 자리/)).toHaveAttribute('aria-pressed', 'true');
    expect(router.state.location.pathname).toBe('/');
  });

  it('moving the finger cancels a long-press', async () => {
    await renderLibrary(sampleLibrary(), { prefs: LIST });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const target = row(/창가 자리/);
    fireEvent.pointerDown(target, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(target, { clientX: 10, clientY: 60 });
    act(() => void vi.advanceTimersByTime(600));
    expect(screen.queryByRole('toolbar', { name: '일괄 편집' })).not.toBeInTheDocument();
  });

  it('bulk remove label only offers labels the selection has', async () => {
    const user = userEvent.setup();
    const { store } = await renderLibrary(sampleLibrary(), { prefs: LIST });
    await shiftClick(user, /속초 횟집/);

    await user.click(within(toolbar()).getByRole('button', { name: '라벨 떼기' }));
    expect(screen.getByRole('menuitem', { name: '맛집' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '바다뷰' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '카페' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: '바다뷰' }));

    await waitFor(() => expect(labelsOf(store.get(libraryAtom), 'place00003')).toEqual([L_FOOD]));
  });

  it('bulk delete shows undo toast that restores', async () => {
    const user = userEvent.setup();
    const { store } = await renderLibrary(sampleLibrary(), { prefs: LIST });
    await shiftClick(user, /창가 자리/, /강남 한 곳/);

    await user.click(within(toolbar()).getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(store.get(libraryAtom).places.place00005!.deletedAt).not.toBeNull());
    expect(screen.queryByRole('button', { name: /창가 자리/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: '일괄 편집' })).not.toBeInTheDocument();

    expect(toastMock).toHaveBeenCalledTimes(1);
    const [message, options] = toastMock.mock.calls[0] as [
      string,
      { duration: number; action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe('2곳을 지웠어요');
    expect(options.duration).toBe(5000);
    expect(options.action.label).toBe('되돌리기');

    await act(async () => {
      options.action.onClick();
    });
    await waitFor(() => expect(store.get(libraryAtom).places.place00005!.deletedAt).toBeNull());
    expect(row(/창가 자리/)).toBeInTheDocument();
    expect(row(/강남 한 곳/)).toBeInTheDocument();
    // 되살아난 장소가 다시 선택된 채로 나타나지 않는다.
    expect(screen.queryByRole('toolbar', { name: '일괄 편집' })).not.toBeInTheDocument();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('surfaces a failed undo as an error toast instead of swallowing it', async () => {
    const user = userEvent.setup();
    const lib = sampleLibrary();
    const { store, storage } = await renderLibrary(lib, { prefs: LIST });
    await shiftClick(user, /중앙시장 닭강정/);
    await user.click(within(toolbar()).getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(store.get(libraryAtom).places.place00001!.deletedAt).not.toBeNull());

    // 그 사이 다른 탭이 같은 네이버 장소(sid)를 다시 저장했다.
    const stored = JSON.parse(storage.getItem(LIBRARY_KEY)!) as { places: Record<string, unknown> };
    const again = makePlace(9, { name: '닭강정 다시 저장', sid: '1001' });
    stored.places[again.id] = again;
    storage.setItem(LIBRARY_KEY, JSON.stringify(stored));

    const options = toastMock.mock.calls[0]![1] as { action: { onClick: () => void } };
    await act(async () => {
      options.action.onClick();
    });
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.error.mock.calls[0]![0]).toContain('저장하지 못했어요');
    expect(store.get(libraryAtom).places.place00001!.deletedAt).not.toBeNull();
  });
  it('selection is dropped when a block filter hides the place, so bulk delete cannot hit hidden places', async () => {
    const user = userEvent.setup();
    const { store } = await renderLibrary(sampleLibrary()); // 기본 보기는 벤토
    const overviewBlock = (name: RegExp) =>
      within(screen.getByRole('group', { name: '라벨 개요' })).getByRole('button', { name });

    await user.click(overviewBlock(/맛집/));
    await shiftClick(user, /중앙시장 닭강정/);
    expect(within(toolbar()).getByText('1곳 선택')).toBeInTheDocument();

    // 다른 블록으로 바꾸면 선택한 장소가 목록에서 빠진다. 보이지 않는 선택도 함께 사라져야 한다.
    await user.click(overviewBlock(/카페/));
    expect(
      within(screen.getByRole('list', { name: '장소 목록' })).getAllByRole('listitem'),
    ).toHaveLength(1);
    expect(screen.queryByRole('toolbar', { name: '일괄 편집' })).not.toBeInTheDocument();
    expect(Object.values(store.get(libraryAtom).places).every((p) => p.deletedAt === null)).toBe(
      true,
    );
  });

  it('undo restores only the places this delete removed, not ones another tab had deleted', async () => {
    const user = userEvent.setup();
    const { store, storage } = await renderLibrary(sampleLibrary(), { prefs: LIST });
    await shiftClick(user, /창가 자리/, /강남 한 곳/);

    // 화면은 모르는 사이 다른 탭이 '강남 한 곳'(place00004)을 먼저 지웠다.
    const stored = JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library;
    const other = { ...stored.places.place00004!, deletedAt: '2026-10-08T02:00:00.000Z' };
    storage.setItem(
      LIBRARY_KEY,
      JSON.stringify({ ...stored, places: { ...stored.places, place00004: other } }),
    );

    await user.click(within(toolbar()).getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(store.get(libraryAtom).places.place00005!.deletedAt).not.toBeNull());
    const [message, options] = toastMock.mock.calls[0] as [
      string,
      { action: { onClick: () => void } },
    ];
    expect(message).toBe('1곳을 지웠어요');

    await act(async () => {
      options.action.onClick();
    });
    await waitFor(() => expect(store.get(libraryAtom).places.place00005!.deletedAt).toBeNull());
    expect(store.get(libraryAtom).places.place00004!.deletedAt).toBe('2026-10-08T02:00:00.000Z');
  });
});
