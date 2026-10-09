import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { liveLabels } from 'src/domain/library/query';
import type { Library } from 'src/schema/library';
import { LIBRARY_KEY } from 'src/services/library-store';
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
