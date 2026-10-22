import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { liveLabels } from 'src/domain/library/query';
import type { FolderLink, Library } from 'src/schema/library';
import { PlaceLookupError } from 'src/services/errors';
import { LIBRARY_KEY } from 'src/services/library-store';
import { PlaceLookup } from 'src/services/place-lookup';
import { addFlowAtom, addOpenerAtom, addTargetAtom } from 'src/stores/add-place';
import { libraryAtom } from 'src/stores/library-state';
import { L_CAFE, L_FOOD, L_SEA, renderLibrary, sampleLibrary } from '../library/fixtures';

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
  vi.restoreAllMocks();
});

const open = (width = 1280) =>
  renderLibrary(sampleLibrary(), { path: '/labels', width, ids: ['label099'] });
const list = () => screen.getByRole('list', { name: '라벨 목록' });
const stored = (storage: Storage) => JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library;
const editor = () => screen.getByRole('dialog', { name: '라벨 고치기' });
const openEditor = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) =>
  user.click(within(list()).getByRole('button', { name }));

describe('LabelsPage', () => {
  it('drag handles are at least 44x44px', async () => {
    await open();
    const handles = within(list()).getAllByRole('button', { name: /순서 바꾸기$/ });
    expect(handles).toHaveLength(3);
    for (const handle of handles) {
      const style = getComputedStyle(handle);
      expect(parseFloat(style.width)).toBeGreaterThanOrEqual(44);
      expect(parseFloat(style.height)).toBeGreaterThanOrEqual(44);
    }
  });

  it('lists labels in order with place counts', async () => {
    await open();
    const items = within(list()).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('맛집');
    expect(items[0]).toHaveTextContent('장소 2곳');
    expect(items[1]).toHaveTextContent('카페');
    expect(items[1]).toHaveTextContent('장소 1곳');
    expect(items[2]).toHaveTextContent('바다뷰');
    expect(items[2]).toHaveTextContent('장소 1곳');
  });

  it('is reachable from the library filter bar', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary());
    await user.click(screen.getByRole('link', { name: '라벨 관리' }));
    expect(router.state.location.pathname).toBe('/labels');
    expect(screen.getByRole('heading', { name: '라벨 관리' })).toBeInTheDocument();
  });

  it('create: adds a label at the end; rejects blank and taken names inline', async () => {
    const user = userEvent.setup();
    const { storage, store } = await open();
    const input = screen.getByRole('textbox', { name: '새 라벨 이름' });

    await user.type(input, '   ');
    await user.click(screen.getByRole('button', { name: '추가' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('1–30자로 입력하세요');

    await user.clear(input);
    await user.type(input, ' 맛집 ');
    await user.click(screen.getByRole('button', { name: '추가' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('같은 이름의 라벨이 있어요');

    await user.clear(input);
    await user.type(input, '산책{Enter}');
    await waitFor(() =>
      expect(liveLabels(store.get(libraryAtom)).map((l) => l.name.value)).toEqual([
        '맛집',
        '카페',
        '바다뷰',
        '산책',
      ]),
    );
    expect(input).toHaveValue('');
    expect(liveLabels(stored(storage)).at(-1)!.name.value).toBe('산책');
    expect(within(list()).getAllByRole('listitem')).toHaveLength(4);
  });

  it('rename: saves on Enter; a taken name shows an error and keeps the editor open', async () => {
    const user = userEvent.setup();
    const { storage } = await open();
    await openEditor(user, /^맛집/);
    const name = within(editor()).getByRole('textbox', { name: '라벨 이름' });

    await user.clear(name);
    await user.type(name, '카페{Enter}');
    expect(await within(editor()).findByRole('alert')).toHaveTextContent(
      '같은 이름의 라벨이 있어요',
    );
    expect(stored(storage).labels[L_FOOD]!.name.value).toBe('맛집');

    // 닫기도 거절된 이름이면 열어 둔다.
    await user.click(within(editor()).getByRole('button', { name: '닫기' }));
    expect(editor()).toBeInTheDocument();

    await user.clear(name);
    expect(within(editor()).queryByRole('alert')).not.toBeInTheDocument();
    await user.type(name, '식당{Enter}');
    await waitFor(() => expect(stored(storage).labels[L_FOOD]!.name.value).toBe('식당'));
    await user.click(within(editor()).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(list()).getAllByRole('listitem')[0]).toHaveTextContent('식당');
  });

  it('rename: an empty name is rejected with the length message', async () => {
    const user = userEvent.setup();
    const { storage } = await open();
    await openEditor(user, /^카페/);
    const name = within(editor()).getByRole('textbox', { name: '라벨 이름' });
    await user.clear(name);
    await user.keyboard('{Enter}');
    expect(await within(editor()).findByRole('alert')).toHaveTextContent('1–30자로 입력하세요');
    expect(stored(storage).labels[L_CAFE]!.name.value).toBe('카페');
  });

  it('rename: saves the pending name when the editor is closed', async () => {
    const user = userEvent.setup();
    const { storage } = await open();
    await openEditor(user, /^카페/);
    const name = within(editor()).getByRole('textbox', { name: '라벨 이름' });
    await user.clear(name);
    await user.type(name, '커피집');
    await user.click(within(editor()).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(stored(storage).labels[L_CAFE]!.name.value).toBe('커피집');
  });

  it('recolor and change icon save immediately', async () => {
    const user = userEvent.setup();
    const { storage } = await open();
    await openEditor(user, /^카페/);

    const colors = within(editor()).getByRole('radiogroup', { name: '색' });
    expect(within(colors).getAllByRole('radio')).toHaveLength(8);
    expect(within(colors).getByRole('radio', { name: '노랑' })).toBeChecked();
    await user.click(within(colors).getByRole('radio', { name: '보라' }));
    await waitFor(() => expect(stored(storage).labels[L_CAFE]!.color.value).toBe('purple'));
    expect(within(colors).getByRole('radio', { name: '보라' })).toBeChecked();

    const icons = within(editor()).getByRole('radiogroup', { name: '아이콘' });
    expect(within(icons).getAllByRole('radio')).toHaveLength(32);
    expect(within(icons).getByRole('radio', { name: '커피' })).toBeChecked();
    await user.click(within(icons).getByRole('radio', { name: '빵' }));
    await waitFor(() => expect(stored(storage).labels[L_CAFE]!.icon.value).toBe('croissant'));
    expect(within(icons).getByRole('radio', { name: '빵' })).toBeChecked();
  });

  it('delete dialog shows affected place count; places remain', async () => {
    const user = userEvent.setup();
    const { storage, store } = await open();
    await openEditor(user, /^맛집/);
    await user.click(within(editor()).getByRole('button', { name: '지우기' }));

    const dialog = await screen.findByRole('dialog', { name: '라벨 지우기' });
    expect(
      within(dialog).getByText(
        '‘맛집’ 라벨을 지울까요? 장소 2곳에서 이 라벨이 빠져요. 장소는 지워지지 않아요.',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(stored(storage).labels[L_FOOD]!.deletedAt).toBeNull();

    await openEditor(user, /^맛집/);
    await user.click(within(editor()).getByRole('button', { name: '지우기' }));
    await user.click(await screen.findByRole('button', { name: '지우기', hidden: false }));
    await waitFor(() => expect(stored(storage).labels[L_FOOD]!.deletedAt).not.toBeNull());
    const lib = store.get(libraryAtom);
    expect(Object.keys(lib.places)).toHaveLength(5);
    expect(lib.places.place00001!.deletedAt).toBeNull();
    expect(lib.places.place00001!.labelIds.value).toEqual([]);
    expect(lib.places.place00003!.labelIds.value).toEqual([L_SEA]);
    await waitFor(() => expect(within(list()).getAllByRole('listitem')).toHaveLength(2));
  });

  it('merge dialog shows count and merges', async () => {
    const user = userEvent.setup();
    const { storage } = await open();
    await openEditor(user, /^맛집/);
    await user.click(within(editor()).getByRole('button', { name: '합치기' }));

    const dialog = await screen.findByRole('dialog', { name: '‘맛집’ 합치기' });
    const confirm = within(dialog).getByRole('button', { name: '합치기' });
    expect(confirm).toBeDisabled();
    expect(within(dialog).queryByRole('radio', { name: '맛집' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: '바다뷰' }));
    expect(
      within(dialog).getByText(
        '‘맛집’를 ‘바다뷰’로 합칠까요? 장소 2곳에 ‘바다뷰’가 붙고 ‘맛집’는 지워져요.',
      ),
    ).toBeInTheDocument();
    await user.click(confirm);

    await waitFor(() => expect(stored(storage).labels[L_FOOD]!.deletedAt).not.toBeNull());
    const places = stored(storage).places;
    expect(places.place00001!.labelIds.value).toEqual([L_SEA]);
    expect(places.place00003!.labelIds.value).toEqual([L_SEA]); // 이미 있던 바다뷰는 한 번만.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(list()).getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows an empty state without labels', async () => {
    await renderLibrary({ ...sampleLibrary(), labels: {}, places: {} }, { path: '/labels' });
    expect(screen.getByText(/라벨이 아직 없어요/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '라벨 목록' })).not.toBeInTheDocument();
  });
});

const SHARE_ID = 'abc123';
const CHECKED_AT = '2026-10-12T03:00:00.000Z';

/** `맛집` 라벨에 네이버 폴더 `속초 맛집`(abc123)이 연결된 보관함. 폴더는 그 라벨의 두 곳을 봤다. */
function linkedLibrary(): Library {
  const base = sampleLibrary();
  const link: FolderLink = {
    shareId: SHARE_ID,
    name: { value: '속초 맛집', updatedAt: CHECKED_AT },
    labelId: { value: L_FOOD, updatedAt: CHECKED_AT },
    seenSids: { value: ['9001', '9002'], updatedAt: CHECKED_AT },
    checkedAt: CHECKED_AT,
    createdAt: CHECKED_AT,
    deletedAt: null,
  };
  return { ...base, folders: { [SHARE_ID]: link } };
}

/** 폴더 조회는 늘 같은 두 곳(본 적 있는 9001과 새로 저장한 9003)을 돌려준다. */
const folderLookup = Layer.succeed(
  PlaceLookup,
  PlaceLookup.of({
    lookupLink: () => Effect.fail(new PlaceLookupError({ code: 'OFFLINE' })),
    lookupFolder: () =>
      Effect.succeed({
        folderName: '속초 맛집',
        places: [
          { sid: '9001', name: '본 곳', address: '강원 속초시 1', lng: 128.5, lat: 38.2, memo: '' },
          { sid: '9003', name: '새 곳', address: '강원 속초시 3', lng: 128.6, lat: 38.2, memo: '' },
        ],
      }),
  }),
);

const openLinked = (width = 1280) =>
  renderLibrary(linkedLibrary(), {
    path: '/labels',
    width,
    ids: ['label099'],
    placeLookup: folderLookup,
  });
const foodRow = () => within(list()).getByRole('button', { name: /^맛집/ });
const resyncButton = () =>
  within(editor()).getByRole('button', { name: '‘속초 맛집’에서 새로 저장한 곳 가져오기' });

describe('LabelsPage — 네이버 폴더', () => {
  it('연결이 있는 라벨 줄은 개수 글자에 `네이버 폴더`를 붙인다', async () => {
    await openLinked();
    const items = within(list()).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('장소 2곳 · 네이버 폴더');
    expect(items[1]).toHaveTextContent('장소 1곳');
    expect(items[1]).not.toHaveTextContent('네이버 폴더');
  });

  it('라벨 고치기에 `네이버 폴더` 구역을 보인다(연결 없는 라벨에는 없음)', async () => {
    const user = userEvent.setup();
    await openLinked();
    await user.click(foodRow());
    const section = within(editor()).getByRole('region', { name: '네이버 폴더' });
    expect(within(section).getByRole('heading', { level: 3, name: '네이버 폴더' })).toBeVisible();
    expect(section).toHaveTextContent('속초 맛집');
    expect(section).toHaveTextContent('2026.10.12 확인');
    const resync = within(section).getByRole('button', {
      name: '‘속초 맛집’에서 새로 저장한 곳 가져오기',
    });
    expect(resync).toHaveTextContent('새로 저장한 곳 가져오기');
    const unlink = within(section).getByRole('button', { name: '‘속초 맛집’ 연결 끊기' });
    expect(unlink).toHaveTextContent('연결 끊기');
    for (const button of [resync, unlink]) {
      expect(parseFloat(getComputedStyle(button).minHeight)).toBeGreaterThanOrEqual(44);
    }

    await user.click(within(editor()).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await openEditor(user, /^카페/);
    expect(within(editor()).queryByRole('region', { name: '네이버 폴더' })).not.toBeInTheDocument();
    expect(within(editor()).queryByText('네이버 폴더')).not.toBeInTheDocument();
  });

  it('이름이 빈 폴더는 `이름 없는 폴더`로 보인다', async () => {
    const user = userEvent.setup();
    const base = linkedLibrary();
    const unnamed = { ...base.folders![SHARE_ID]!, name: { value: '', updatedAt: CHECKED_AT } };
    await renderLibrary(
      { ...base, folders: { [SHARE_ID]: unnamed } },
      { path: '/labels', ids: ['label099'] },
    );
    await user.click(foodRow());
    const section = within(editor()).getByRole('region', { name: '네이버 폴더' });
    expect(section).toHaveTextContent('이름 없는 폴더');
    expect(
      within(section).getByRole('button', { name: '‘이름 없는 폴더’ 연결 끊기' }),
    ).toBeInTheDocument();
  });

  it('`새로 저장한 곳 가져오기`는 대화상자를 닫고 그 폴더의 다시 가져오기를 연다', async () => {
    const user = userEvent.setup();
    const { store } = await openLinked();
    await user.click(foodRow());
    await user.click(resyncButton());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(store.get(addFlowAtom)).toEqual({
      step: 'folder',
      shareId: SHARE_ID,
      seq: expect.any(Number),
    });
    expect(store.get(addTargetAtom)).toBeNull();
    expect(store.get(addOpenerAtom)).toBe(foodRow());
  });

  it('넓은 화면: 포커스가 추가 칸 안으로 가고, Esc로 닫으면 그 라벨 줄로 돌아온다', async () => {
    const user = userEvent.setup();
    const { store } = await openLinked(1280);
    await user.click(foodRow());
    await user.click(resyncButton());
    const panel = await screen.findByRole('region', { name: '장소 추가' });
    expect(await within(panel).findByRole('heading', { name: '속초 맛집' })).toBeInTheDocument();
    await waitFor(() => expect(panel).toContainElement(document.activeElement as HTMLElement));

    await user.keyboard('{Escape}');
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    expect(screen.queryByRole('region', { name: '장소 추가' })).not.toBeInTheDocument();
    await waitFor(() => expect(foodRow()).toHaveFocus());
  });

  it('넓은 화면: 폴더 전체 보기 뒤 같은 라벨의 가져오기를 다시 누르면 다시 읽고 다시 가져오기 화면으로 돌아온다', async () => {
    const user = userEvent.setup();
    const calls: { fresh: boolean }[] = [];
    let extra = false;
    const place = (n: number) => ({
      sid: `900${n}`,
      name: n === 1 ? '본 곳' : `새 곳 ${n}`,
      address: `강원 속초시 ${n}`,
      lng: 128.5 + n / 100,
      lat: 38.2,
      memo: '',
    });
    const lookup = Layer.succeed(
      PlaceLookup,
      PlaceLookup.of({
        lookupLink: () => Effect.fail(new PlaceLookupError({ code: 'OFFLINE' })),
        lookupFolder: (_shareId, options) =>
          Effect.sync(() => {
            calls.push({ fresh: options?.fresh === true });
            return {
              folderName: '속초 맛집',
              places: [place(1), place(3), ...(extra ? [place(4)] : [])],
            };
          }),
      }),
    );
    await renderLibrary(linkedLibrary(), {
      path: '/labels',
      width: 1280,
      ids: ['label099'],
      placeLookup: lookup,
    });
    await user.click(foodRow());
    await user.click(resyncButton());
    const panel = await screen.findByRole('region', { name: '장소 추가' });
    expect(await within(panel).findByRole('heading', { name: '속초 맛집' })).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: '폴더 전체 보기' }));
    expect(within(panel).queryByRole('list', { name: '새로 저장한 곳' })).not.toBeInTheDocument();
    expect(calls).toEqual([{ fresh: true }]);

    extra = true;
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(foodRow());
    await user.click(resyncButton());

    await waitFor(() => expect(calls).toEqual([{ fresh: true }, { fresh: true }]));
    const again = await screen.findByRole('region', { name: '장소 추가' });
    const fresh = await within(again).findByRole('list', { name: '새로 저장한 곳' });
    expect(within(fresh).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(fresh).getByRole('checkbox', { name: /새 곳 4/ })).toBeInTheDocument();
    expect(within(again).getByRole('button', { name: '폴더 전체 보기' })).toBeInTheDocument();
  });

  it('좁은 화면: 포커스가 추가 시트 안으로 가고, `취소`로 닫으면 그 라벨 줄로 돌아온다', async () => {
    const user = userEvent.setup();
    const { store } = await openLinked(390);
    await user.click(foodRow());
    await user.click(resyncButton());
    const sheet = await screen.findByRole('dialog', { name: '장소 추가' });
    expect(await within(sheet).findByRole('heading', { name: '속초 맛집' })).toBeInTheDocument();
    await waitFor(() => expect(sheet).toContainElement(document.activeElement as HTMLElement));

    await user.click(within(sheet).getByRole('button', { name: '취소' }));
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '장소 추가' })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(foodRow()).toHaveFocus());
  });

  it('연결이 둘이면 하나를 끊은 뒤 남은 연결의 `새로 저장한 곳 가져오기`로 포커스한다', async () => {
    const user = userEvent.setup();
    const base = linkedLibrary();
    const other: FolderLink = {
      ...base.folders![SHARE_ID]!,
      shareId: 'def456',
      name: { value: '양양 맛집', updatedAt: CHECKED_AT },
    };
    const { storage } = await renderLibrary(
      { ...base, folders: { ...base.folders, def456: other } },
      { path: '/labels', ids: ['label099'] },
    );
    await user.click(foodRow());
    const section = within(editor()).getByRole('region', { name: '네이버 폴더' });
    expect(
      within(section)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining('속초 맛집'), expect.stringContaining('양양 맛집')]);
    await user.click(within(section).getByRole('button', { name: '‘속초 맛집’ 연결 끊기' }));
    await waitFor(() => expect(stored(storage).folders![SHARE_ID]!.deletedAt).not.toBeNull());
    await waitFor(() =>
      expect(
        within(editor()).getByRole('button', { name: '‘양양 맛집’에서 새로 저장한 곳 가져오기' }),
      ).toHaveFocus(),
    );
    expect(stored(storage).folders!.def456!.deletedAt).toBeNull();
  });

  it('마지막 연결을 끊으면 구역이 사라지고 `닫기`로 포커스한다', async () => {
    const user = userEvent.setup();
    await openLinked();
    await user.click(foodRow());
    await user.click(within(editor()).getByRole('button', { name: '‘속초 맛집’ 연결 끊기' }));
    await waitFor(() =>
      expect(
        within(editor()).queryByRole('region', { name: '네이버 폴더' }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(within(editor()).getByRole('button', { name: '닫기' })).toHaveFocus(),
    );
  });

  it('`연결 끊기`를 빠르게 두 번 눌러도 한 번만 끊고 한 번만 알린다', async () => {
    const user = userEvent.setup();
    const { storage } = await openLinked();
    await user.click(foodRow());
    const unlink = within(editor()).getByRole('button', { name: '‘속초 맛집’ 연결 끊기' });
    // 첫 저장이 끝나기 전에 두 번째 누름이 오도록 한 틱 안에 두 번 누른다.
    act(() => {
      fireEvent.click(unlink);
      fireEvent.click(unlink);
    });
    await waitFor(() => expect(stored(storage).folders![SHARE_ID]!.deletedAt).not.toBeNull());
    await waitFor(() =>
      expect(within(editor()).getByRole('button', { name: '닫기' })).toHaveFocus(),
    );
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it('`연결 끊기`는 바로 끊고 알린 뒤 구역을 지운다(라벨·장소는 그대로)', async () => {
    const user = userEvent.setup();
    const { storage, store } = await openLinked();
    await user.click(foodRow());
    await user.click(within(editor()).getByRole('button', { name: '‘속초 맛집’ 연결 끊기' }));
    await waitFor(() => expect(stored(storage).folders![SHARE_ID]!.deletedAt).not.toBeNull());
    expect(toastMock).toHaveBeenCalledWith('폴더 연결을 끊었어요. 라벨과 장소는 그대로예요');
    await waitFor(() =>
      expect(
        within(editor()).queryByRole('region', { name: '네이버 폴더' }),
      ).not.toBeInTheDocument(),
    );
    const lib = store.get(libraryAtom);
    expect(lib.labels[L_FOOD]!.deletedAt).toBeNull();
    expect(lib.places.place00001!.labelIds.value).toContain(L_FOOD);
    await user.click(within(editor()).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(list()).getAllByRole('listitem')[0]).toHaveTextContent('장소 2곳');
    expect(within(list()).getAllByRole('listitem')[0]).not.toHaveTextContent('네이버 폴더');
  });

  it('연결 있는 라벨의 지우기 확인은 연결도 끊긴다고 알리고, 지우면 연결도 지운다', async () => {
    const user = userEvent.setup();
    const { storage } = await openLinked();
    await user.click(foodRow());
    await user.click(within(editor()).getByRole('button', { name: '지우기' }));
    const dialog = await screen.findByRole('dialog', { name: '라벨 지우기' });
    expect(
      within(dialog).getByText(
        '‘맛집’ 라벨을 지울까요? 장소 2곳에서 이 라벨이 빠져요. 장소는 지워지지 않아요. 연결된 네이버 폴더도 끊겨요.',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '지우기' }));
    await waitFor(() => expect(stored(storage).labels[L_FOOD]!.deletedAt).not.toBeNull());
    expect(stored(storage).folders![SHARE_ID]!.deletedAt).not.toBeNull();
  });
});

describe('LabelsPage — 이모지', () => {
  it('고르기·지우기를 즉시 저장하고 화살표/Home/End로 고른다', async () => {
    const user = userEvent.setup();
    const { storage } = await open();
    await openEditor(user, /^카페/);
    const group = within(editor()).getByRole('radiogroup', { name: '이모지' });
    const none = within(group).getByRole('radio', { name: '이모지 없음' });
    expect(none).toBeChecked();
    await user.click(within(group).getByRole('radio', { name: '빵' }));
    await waitFor(() => expect(stored(storage).labels[L_CAFE]!.emoji?.value).toBe('🥐'));
    expect(within(group).getByRole('radio', { name: '빵' })).toBeChecked();
    await user.keyboard('{Home}');
    await waitFor(() => expect(stored(storage).labels[L_CAFE]!.emoji?.value).toBeNull());
    expect(none).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(stored(storage).labels[L_CAFE]!.emoji?.value).toBe('☕'));
    expect(within(group).getByRole('radio', { name: '카페' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(within(group).getByRole('radio', { name: '데이트' })).toHaveFocus();
    await user.keyboard('{Home}{ArrowDown} ');
    await waitFor(() => expect(stored(storage).labels[L_CAFE]!.emoji?.value).toBe('☕'));
    await user.click(none);
    await waitFor(() => expect(stored(storage).labels[L_CAFE]!.emoji?.value).toBeNull());
    expect(stored(storage).labels[L_CAFE]!.icon.value).toBe('coffee');
    for (const radio of within(group).getAllByRole('radio')) {
      expect(parseFloat(getComputedStyle(radio).minHeight)).toBeGreaterThanOrEqual(44);
      expect(parseFloat(getComputedStyle(radio).minWidth)).toBeGreaterThanOrEqual(44);
    }
  });

  it('미리보기에서 이모지 있음·추천 없음을 빼고 체크한 것만 적용·되돌린다', async () => {
    const user = userEvent.setup();
    const base = sampleLibrary();
    const lib = {
      ...base,
      labels: {
        ...base.labels,
        [L_SEA]: { ...base.labels[L_SEA]!, name: { ...base.labels[L_SEA]!.name, value: '센픽' } },
      },
    };
    const { storage } = await renderLibrary(lib, { path: '/labels' });
    await user.click(screen.getByRole('button', { name: '이름으로 이모지 정하기' }));
    const preview = screen.getByRole('dialog', { name: '이름으로 이모지 정하기' });
    expect(within(preview).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(preview).queryByText('센픽')).not.toBeInTheDocument();
    const food = within(preview).getByRole('checkbox', { name: /맛집.*식당/ });
    expect(food).toBeChecked();
    await user.click(food);
    await user.click(within(preview).getByRole('button', { name: '적용' }));
    await waitFor(() => expect(stored(storage).labels[L_CAFE]!.emoji?.value).toBe('☕'));
    expect(stored(storage).labels[L_FOOD]!.emoji).toBeUndefined();
    expect(toastMock).toHaveBeenCalledWith(
      '라벨 1개의 이모지를 정했어요',
      expect.objectContaining({
        duration: 8000,
        action: expect.objectContaining({ label: '되돌리기' }),
      }),
    );
    const options = toastMock.mock.calls.find(
      (call) => call[0] === '라벨 1개의 이모지를 정했어요',
    )![1];
    await act(async () => {
      await options.action.onClick();
    });
    await waitFor(() => expect(stored(storage).labels[L_CAFE]!.emoji?.value).toBeNull());
  });

  it('기존 이모지를 건너뛰고 빈 미리보기·취소는 저장하지 않는다', async () => {
    const user = userEvent.setup();
    const base = sampleLibrary();
    const labels = Object.fromEntries(
      Object.entries(base.labels).map(([id, label]) => [
        id,
        { ...label, emoji: { value: '❤️', updatedAt: label.createdAt } },
      ]),
    );
    const { storage } = await renderLibrary({ ...base, labels }, { path: '/labels' });
    const before = storage.getItem(LIBRARY_KEY);
    await user.click(screen.getByRole('button', { name: '이름으로 이모지 정하기' }));
    const preview = screen.getByRole('dialog', { name: '이름으로 이모지 정하기' });
    expect(within(preview).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(preview).getByText('추천할 라벨이 없어요')).toBeVisible();
    expect(within(preview).getByRole('button', { name: '적용' })).toBeDisabled();
    await user.click(within(preview).getByRole('button', { name: '취소' }));
    expect(storage.getItem(LIBRARY_KEY)).toBe(before);
  });

  it('미리보기 후 다른 탭이 이모지를 바꾸면 적용하지 않는다', async () => {
    const user = userEvent.setup();
    const { storage, store } = await open();
    await user.click(screen.getByRole('button', { name: '이름으로 이모지 정하기' }));
    const lib = stored(storage);
    const latest = {
      ...lib,
      labels: {
        ...lib.labels,
        [L_CAFE]: {
          ...lib.labels[L_CAFE]!,
          emoji: { value: '❤️', updatedAt: '2026-10-23T03:00:00.000Z' },
        },
      },
    };
    storage.setItem(LIBRARY_KEY, JSON.stringify(latest));
    act(() => store.set(libraryAtom, latest));
    const preview = screen.getByRole('dialog', { name: '이름으로 이모지 정하기' });
    await user.click(within(preview).getByRole('button', { name: '적용' }));
    await waitFor(() => expect(stored(storage).labels[L_FOOD]!.emoji?.value).toBe('🍽️'));
    expect(stored(storage).labels[L_CAFE]!.emoji?.value).toBe('❤️');
    expect(toastMock).toHaveBeenCalledWith('다른 곳에서 바뀐 부분은 그대로 두었어요');
  });
});

it('일괄 추천 저장이 실패하면 미리보기와 체크를 남기고 되돌리기 토스트를 띄우지 않는다', async () => {
  const user = userEvent.setup();
  const { storage } = await open();
  const before = storage.getItem(LIBRARY_KEY);
  await user.click(screen.getByRole('button', { name: '이름으로 이모지 정하기' }));
  const preview = screen.getByRole('dialog', { name: '이름으로 이모지 정하기' });
  const write = vi.spyOn(storage, 'setItem').mockImplementation(() => {
    throw new DOMException('저장 공간 부족', 'QuotaExceededError');
  });
  await user.click(within(preview).getByRole('button', { name: '적용' }));
  await waitFor(() => expect(within(preview).getByRole('button', { name: '적용' })).toBeEnabled());
  expect(storage.getItem(LIBRARY_KEY)).toBe(before);
  expect(
    within(preview)
      .getAllByRole('checkbox')
      .every((box) => (box as HTMLInputElement).checked),
  ).toBe(true);
  expect(toastMock.mock.calls.some((call) => call[1]?.action?.label === '되돌리기')).toBe(false);
  write.mockRestore();
  await user.click(within(preview).getByRole('button', { name: '적용' }));
  await waitFor(() => expect(stored(storage).labels[L_CAFE]!.emoji?.value).toBe('☕'));
});

it('목록에 없는 유효한 현재 이모지도 선택으로 보이고 지울 수 있다', async () => {
  const user = userEvent.setup();
  const base = sampleLibrary();
  const lib = {
    ...base,
    labels: {
      ...base.labels,
      [L_CAFE]: {
        ...base.labels[L_CAFE]!,
        emoji: { value: '🧑🏾‍🚀', updatedAt: base.labels[L_CAFE]!.createdAt },
      },
    },
  };
  const { storage } = await renderLibrary(lib, { path: '/labels' });
  await openEditor(user, /^카페/);
  const group = within(editor()).getByRole('radiogroup', { name: '이모지' });
  expect(within(group).getByRole('radio', { name: '현재 이모지' })).toBeChecked();
  expect(within(group).getByText('🧑🏾‍🚀')).toHaveAttribute('aria-hidden', 'true');
  await user.click(within(group).getByRole('radio', { name: '이모지 없음' }));
  await waitFor(() => expect(stored(storage).labels[L_CAFE]!.emoji?.value).toBeNull());
});

it('토스트 되돌리기도 다른 탭의 새 이모지를 유지한다', async () => {
  const user = userEvent.setup();
  const { storage } = await open();
  await user.click(screen.getByRole('button', { name: '이름으로 이모지 정하기' }));
  const preview = screen.getByRole('dialog', { name: '이름으로 이모지 정하기' });
  await user.click(within(preview).getByRole('button', { name: '적용' }));
  await waitFor(() => expect(stored(storage).labels[L_CAFE]!.emoji?.value).toBe('☕'));
  const lib = stored(storage);
  storage.setItem(
    LIBRARY_KEY,
    JSON.stringify({
      ...lib,
      labels: {
        ...lib.labels,
        [L_CAFE]: {
          ...lib.labels[L_CAFE]!,
          emoji: { value: '❤️', updatedAt: '2026-10-24T03:00:00.000Z' },
        },
      },
    }),
  );
  const options = toastMock.mock.calls.find((call) => call[1]?.action?.label === '되돌리기')![1];
  await act(async () => {
    await options.action.onClick();
  });
  expect(stored(storage).labels[L_CAFE]!.emoji?.value).toBe('❤️');
  expect(stored(storage).labels[L_FOOD]!.emoji?.value).toBeNull();
  expect(toastMock).toHaveBeenCalledWith('다른 곳에서 바뀐 부분은 그대로 두었어요');
});
