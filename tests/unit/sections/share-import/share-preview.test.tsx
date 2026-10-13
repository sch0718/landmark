import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUERY } from 'src/domain/library/query';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import type { Prefs } from 'src/schema/prefs';
import type { ShareDoc } from 'src/schema/share';
import { addFlowAtom } from 'src/stores/add-place';
import { libraryAtom } from 'src/stores/library-state';
import { L_CAFE, makePlace, renderLibrary, sampleLibrary, withPlaces } from '../library/fixtures';

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
  toastMock.mockClear();
  toastMock.error.mockClear();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

const IDS = ['newlab01', 'newlab02', 'newplace01', 'newplace02'];

/**
 * 3곳·라벨 2개. `바다 앞 카페`(9001)는 보관함의 `저장된 장소`와 같고, `창가 카페`에만 받은 메모가 있다.
 * `카페`는 내 라벨과 이름이 같고 `바다`는 없다. 만든 때는 KST·UTC 모두 10월 13일이다.
 */
function makeDoc(over: { firstMemo?: string } = {}): ShareDoc {
  return {
    format: 'tripmap-share',
    version: 1,
    title: '강릉 모음',
    createdAt: '2026-10-13T03:00:00.000Z',
    labels: [
      { id: 's1', name: '카페', color: 'green', order: 0 },
      { id: 's2', name: '바다', color: 'blue', order: 1 },
    ],
    places: [
      {
        id: 'p1',
        name: '바다 앞 카페',
        address: '강원 강릉시 창해로 1',
        lng: 128.95,
        lat: 37.77,
        labelIds: ['s1'],
        naverSid: '9001',
        ...(over.firstMemo === undefined ? {} : { memo: over.firstMemo }),
      },
      {
        id: 'p2',
        name: '경포 해변',
        address: '강원 강릉시 창해로 2',
        lng: 128.9,
        lat: 37.8,
        labelIds: ['s2'],
      },
      {
        id: 'p3',
        name: '창가 카페',
        address: '강원 강릉시 창해로 3',
        lng: 128.91,
        lat: 37.79,
        labelIds: ['s1'],
        memo: '창가 자리 추천',
      },
    ],
  };
}

const baseLibrary = (): Library =>
  withPlaces(sampleLibrary(), [makePlace(6, { name: '저장된 장소', sid: '9001' })]);

const panel = () => screen.getByRole('region', { name: '장소 추가' });
const queryPanel = () => screen.queryByRole('region', { name: '장소 추가' });
const importButton = (count: number) =>
  within(panel()).getByRole('button', { name: `${count}곳 가져오기` });
const row = (name: string) => within(panel()).getByRole('checkbox', { name: new RegExp(name) });
const rowBox = (name: string) => row(name).closest('label')!;
const labelRows = () =>
  within(within(panel()).getByRole('list', { name: '받은 라벨' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);
const titleSwitch = () => within(panel()).getByRole('switch', { name: '파일 제목 라벨도 붙이기' });
const memoSwitch = () => within(panel()).getByRole('switch', { name: '받은 메모도 덧붙이기' });
const titleInput = () => within(panel()).getByRole('textbox', { name: '파일 제목 라벨 이름' });
const pressed = (name: RegExp) =>
  within(screen.getByRole('group', { name: '라벨' })).getByRole('button', { name });

/** 보관함을 그리고 공유 미리보기 단계로 연다. */
async function openShare(
  options: { library?: Library; doc?: ShareDoc; prefs?: Partial<Prefs>; ids?: string[] } = {},
) {
  const user = userEvent.setup();
  const rendered = await renderLibrary(options.library ?? baseLibrary(), {
    ids: options.ids ?? IDS,
    prefs: { libraryView: 'list', ...options.prefs },
  });
  const doc = options.doc ?? makeDoc();
  act(() => rendered.store.set(addFlowAtom, { step: 'share', doc }));
  await within(panel()).findByRole('heading', { name: '강릉 모음 · 3곳' });
  return { user, ...rendered };
}

describe('공유 파일 미리보기', () => {
  it('머리글·날짜·행·표시·라벨 줄을 보인다', async () => {
    await openShare();
    expect(within(panel()).getByText('2026.10.13 만든 파일')).toBeInTheDocument();
    for (const name of ['바다 앞 카페', '경포 해변', '창가 카페']) expect(row(name)).toBeChecked();
    expect(within(panel()).getByText('강원 강릉시 창해로 2')).toBeInTheDocument();
    // 같은 장소에만 `이미 있음`, 받은 메모가 있는 행에만 `메모`.
    expect(within(panel()).getAllByText('이미 있음')).toHaveLength(1);
    expect(within(rowBox('바다 앞 카페')).getByText('이미 있음')).toBeInTheDocument();
    expect(within(panel()).getAllByText('메모')).toHaveLength(1);
    expect(within(rowBox('창가 카페')).getByText('메모')).toBeInTheDocument();
    // 행마다 받은 라벨 칩.
    expect(within(rowBox('경포 해변')).getByText('바다')).toBeInTheDocument();
    expect(labelRows()).toEqual(['카페내 라벨에 합침', '바다새로 만듦']);
    expect(importButton(3)).toBeEnabled();
  });

  it('모두 해제하면 버튼이 꺼지고, 한 행만 켜면 그 행이 쓰는 라벨만 남는다', async () => {
    const { user } = await openShare();
    await user.click(within(panel()).getByRole('button', { name: '모두 해제' }));
    for (const name of ['바다 앞 카페', '경포 해변', '창가 카페']) {
      expect(row(name)).not.toBeChecked();
    }
    expect(importButton(0)).toBeDisabled();
    expect(within(panel()).queryByRole('list', { name: '받은 라벨' })).not.toBeInTheDocument();

    await user.click(row('경포 해변'));
    expect(importButton(1)).toBeEnabled();
    expect(labelRows()).toEqual(['바다새로 만듦']);

    await user.click(within(panel()).getByRole('button', { name: '모두 선택' }));
    expect(importButton(3)).toBeEnabled();
  });

  it('제목 라벨: 기본값, 31자·빈 이름은 막고, 스위치를 끄면 입력이 숨는다', async () => {
    const { user } = await openShare();
    expect(titleSwitch()).toBeChecked();
    expect(titleInput()).toHaveValue('강릉 모음');
    expect(within(panel()).getAllByText('내 라벨에 합침')).toHaveLength(1);

    await user.clear(titleInput());
    await user.type(titleInput(), '가'.repeat(31));
    expect(within(panel()).getByText('라벨 이름은 30자까지예요')).toBeInTheDocument();
    expect(importButton(3)).toBeDisabled();

    await user.clear(titleInput());
    expect(within(panel()).queryByText('라벨 이름은 30자까지예요')).not.toBeInTheDocument();
    expect(importButton(3)).toBeDisabled();

    await user.type(titleInput(), '가'.repeat(31));
    await user.click(titleSwitch());
    expect(within(panel()).queryByRole('textbox', { name: '파일 제목 라벨 이름' })).toBeNull();
    expect(within(panel()).queryByText('라벨 이름은 30자까지예요')).not.toBeInTheDocument();
    expect(importButton(3)).toBeEnabled();
  });

  it('제목 라벨이 내 라벨과 같으면 입력 아래 합침을 보이고 같은 받은 라벨 줄은 뺀다', async () => {
    const { user } = await openShare();
    await user.clear(titleInput());
    await user.type(titleInput(), '카페');
    const merged = within(panel()).getAllByText('내 라벨에 합침');
    expect(merged).toHaveLength(1);
    expect(labelRows()).toEqual(['바다새로 만듦']);
  });

  it('제목이 빈 파일은 제목 라벨 기본값이 받은 장소다', async () => {
    const rendered = await renderLibrary(baseLibrary(), { prefs: { libraryView: 'list' } });
    act(() =>
      rendered.store.set(addFlowAtom, { step: 'share', doc: { ...makeDoc(), title: '  ' } }),
    );
    await within(panel()).findByRole('heading', { name: '· 3곳' });
    expect(titleInput()).toHaveValue('받은 장소');
  });

  it('이미 있는 장소에 받은 메모가 없으면 메모 덧붙이기는 꺼진 채 비활성이다', async () => {
    await openShare();
    expect(memoSwitch()).toBeDisabled();
    expect(memoSwitch()).not.toBeChecked();
    expect(
      within(panel()).getByText(
        '이미 있는 장소에만 해당해요. 새로 넣는 장소에는 받은 메모가 그대로 들어가요',
      ),
    ).toBeInTheDocument();
  });

  it('이미 있는 장소에 받은 메모가 있으면 켜진 채 시작하고, 가져오면 메모를 덧붙인다', async () => {
    const { user, store } = await openShare({ doc: makeDoc({ firstMemo: '주차 가능' }) });
    expect(memoSwitch()).toBeEnabled();
    expect(memoSwitch()).toBeChecked();
    // 그 장소를 해제하면 해당하는 곳이 없다.
    await user.click(row('바다 앞 카페'));
    expect(memoSwitch()).toBeDisabled();
    expect(memoSwitch()).not.toBeChecked();
    await user.click(row('바다 앞 카페'));
    expect(memoSwitch()).toBeChecked();

    await user.click(importButton(3));
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    const lib = store.get(libraryAtom);
    expect(lib.places.place00006!.memo.value).toBe('— 받은 메모 (강릉 모음):\n주차 가능');
    // 새로 넣은 장소에는 받은 메모가 그대로 들어간다.
    expect(lib.places.newplace02!.memo.value).toBe('창가 자리 추천');
  });

  it('메모 덧붙이기를 끄면 이미 있는 장소의 메모는 그대로다', async () => {
    const { user, store } = await openShare({ doc: makeDoc({ firstMemo: '주차 가능' }) });
    await user.click(memoSwitch());
    await user.click(importButton(3));
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(store.get(libraryAtom).places.place00006!.memo.value).toBe('');
  });

  it('가져오면 결과를 알리고, 목록을 제목 라벨로 거르고, 흐름을 닫는다', async () => {
    const { user, store } = await openShare({
      prefs: { query: { ...DEFAULT_QUERY, text: '저장된', regions: ['없는 지역'] } },
    });
    await user.click(importButton(3));
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith('2곳을 새로 넣고, 1곳은 라벨만 더했어요');
    expect(queryPanel()).not.toBeInTheDocument();

    const lib = store.get(libraryAtom);
    expect(lib.labels.newlab01!.name.value).toBe('강릉 모음');
    expect(lib.labels.newlab02!.name.value).toBe('바다');
    expect(lib.places.place00006!.labelIds.value).toEqual([L_CAFE, 'newlab01']);
    expect(lib.places.newplace01!.labelIds.value).toEqual(['newlab02', 'newlab01']);

    expect(screen.getByRole('searchbox')).toHaveValue('');
    await waitFor(() => expect(pressed(/^강릉 모음/)).toHaveAttribute('aria-pressed', 'true'));
  });

  it('제목 라벨을 끄고 가져오면 필터를 건드리지 않는다', async () => {
    // 제목 라벨이 없으니 첫 id는 `바다` 라벨이 쓴다.
    const { user, store } = await openShare({
      prefs: { query: { ...DEFAULT_QUERY, text: '저장된' } },
      ids: ['newlab02', 'newplace01', 'newplace02'],
    });
    await user.click(titleSwitch());
    await user.click(importButton(3));
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(toastMock).toHaveBeenCalledWith('2곳을 새로 넣고, 1곳은 라벨만 더했어요');
    expect(screen.getByRole('searchbox')).toHaveValue('저장된');
    const lib = store.get(libraryAtom);
    expect(Object.values(lib.labels).some((l) => l.name.value === '강릉 모음')).toBe(false);
    expect(pressed(/^카페/)).toHaveAttribute('aria-pressed', 'false');
  });

  it('빠르게 두 번 눌러도 한 번만 넣고, 저장 중에는 취소도 막는다', async () => {
    const { store } = await openShare();
    const button = importButton(3);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(within(panel()).getByRole('button', { name: '취소' })).toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(store.get(libraryAtom).places)).toHaveLength(8);
  });

  it('저장 중에 흐름이 닫혀도 토스트는 띄우되 필터는 건드리지 않는다', async () => {
    const { store } = await openShare();
    fireEvent.click(importButton(3));
    act(() => store.set(addFlowAtom, { step: 'closed' }));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith('2곳을 새로 넣고, 1곳은 라벨만 더했어요'),
    );
    expect(Object.keys(store.get(libraryAtom).places)).toHaveLength(8);
    expect(pressed(/^강릉 모음/)).toHaveAttribute('aria-pressed', 'false');
  });

  it('취소하면 아무것도 넣지 않고 닫는다', async () => {
    const { user, store } = await openShare();
    await user.click(within(panel()).getByRole('button', { name: '취소' }));
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    expect(Object.keys(store.get(libraryAtom).places)).toHaveLength(6);
    expect(Object.keys(store.get(libraryAtom).labels)).toHaveLength(3);
    expect(toastMock).not.toHaveBeenCalled();
  });
});
