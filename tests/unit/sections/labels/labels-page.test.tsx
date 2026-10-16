import { cleanup, screen, waitFor, within } from '@testing-library/react';
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
    expect(store.get(addFlowAtom)).toEqual({ step: 'folder', shareId: SHARE_ID });
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
