import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { emptyLibrary } from 'src/schema/library';
import type { Library } from 'src/schema/library';
import type { Prefs } from 'src/schema/prefs';
import { PREFS_KEY } from 'src/services/prefs-store';
import { libraryAtom } from 'src/stores/library-state';
import { LIBRARY_KEY } from 'src/services/library-store';
import { renderLibrary, sampleLibrary } from '../library/fixtures';
import { dialog, jsonFile, NEW_IDS, stubTripFetch, tripOf } from './import-fixtures';

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
  toastMock.mockClear();
  toastMock.error.mockClear();
});
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'storage');
});

const open = () => renderLibrary(sampleLibrary(), { path: '/settings', ids: NEW_IDS });
const savedPrefs = (storage: Storage) => JSON.parse(storage.getItem(PREFS_KEY)!) as Prefs;
const stored = (storage: Storage) => JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library;

describe('SettingsPage', () => {
  it('theme/mode/view changes persist via PrefsStore and apply immediately', async () => {
    const user = userEvent.setup();
    const { storage } = await open();
    expect(screen.getByRole('heading', { name: '설정' })).toBeInTheDocument();

    const themes = within(screen.getByRole('radiogroup', { name: '테마' }));
    expect(themes.getAllByRole('radio').map((b) => b.textContent)).toEqual([
      '파스텔',
      '수첩',
      '나이트',
    ]);
    expect(themes.getByRole('radio', { name: '파스텔' })).toHaveAttribute('aria-checked', 'true');
    await user.click(themes.getByRole('radio', { name: '나이트' }));
    expect(document.documentElement.dataset.theme).toBe('night');
    expect(themes.getByRole('radio', { name: '나이트' })).toHaveAttribute('aria-checked', 'true');

    const modes = within(screen.getByRole('radiogroup', { name: '모드' }));
    expect(modes.getAllByRole('radio').map((b) => b.textContent)).toEqual([
      '시스템',
      '라이트',
      '다크',
    ]);
    await user.click(modes.getByRole('radio', { name: '다크' }));
    expect(document.documentElement.dataset.mode).toBe('dark');

    const views = within(screen.getByRole('radiogroup', { name: '보관함 보기' }));
    expect(views.getAllByRole('radio').map((b) => b.textContent)).toEqual([
      '벤토',
      '카드',
      '타일',
      '목록',
    ]);
    await user.click(views.getByRole('radio', { name: '타일' }));

    await waitFor(() =>
      expect(savedPrefs(storage)).toMatchObject({
        theme: 'night',
        mode: 'dark',
        libraryView: 'tiles',
      }),
    );
  });

  it('도움말 링크와 처음 안내 초기화를 제공한다', async () => {
    const user = userEvent.setup();
    await open();
    const section = within(screen.getByRole('region', { name: '도움말' }));
    expect(section.getByText('메뉴별 사용법을 그림으로 볼 수 있어요')).toBeInTheDocument();
    expect(section.getByRole('link', { name: '도움말 보기' })).toHaveAttribute('href', '/help');
    await user.click(section.getByRole('button', { name: '처음 안내 다시 보기' }));
    expect(localStorage.getItem('tripmap:help-seen:v1')).toBeNull();
    expect(toastMock).toHaveBeenCalledWith('처음 안내를 다시 보여 드릴게요');
  });

  it('data info shows counts', async () => {
    const { store } = await open();
    const bytes = JSON.stringify(store.get(libraryAtom)).length * 2;
    const kb = Math.max(1, Math.round(bytes / 1024));
    expect(screen.getByText(`장소 5곳 · 라벨 3개 · 사용 용량 약 ${kb} KB`)).toBeInTheDocument();
  });

  it('sections appear in the documented order', async () => {
    await open();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      '테마',
      '모드',
      '보관함 보기',
      '백업',
      '가져오기',
      '도움말',
      '데이터 정보',
    ]);
  });

  it('data info adds the storage protection state when the browser reports it', async () => {
    Object.defineProperty(navigator, 'storage', {
      value: { persisted: vi.fn(() => Promise.resolve(true)) },
      configurable: true,
    });
    const { store } = await open();
    const kb = Math.max(1, Math.round((JSON.stringify(store.get(libraryAtom)).length * 2) / 1024));
    expect(
      await screen.findByText(`장소 5곳 · 라벨 3개 · 사용 용량 약 ${kb} KB · 저장 보호 켜짐`),
    ).toBeInTheDocument();
  });

  it('data info says protection is off when persisted() is false', async () => {
    Object.defineProperty(navigator, 'storage', {
      value: { persisted: vi.fn(() => Promise.resolve(false)) },
      configurable: true,
    });
    await open();
    expect(await screen.findByText(/ · 저장 보호 꺼짐$/)).toBeInTheDocument();
  });

  it('data info adds nothing without navigator.storage', async () => {
    await open();
    await act(async () => {});
    expect(screen.getByText(/사용 용량 약 \d+ KB$/)).toBeInTheDocument();
    expect(screen.queryByText(/저장 보호/)).not.toBeInTheDocument();
  });

  it('opens the import dialog from the library empty state and clears the query', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(emptyLibrary());
    await user.click(screen.getByRole('button', { name: '옛 여행 가져오기' }));
    expect(router.state.location.pathname).toBe('/settings');
    expect(dialog()).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(dialog()).toBeInTheDocument();
  });

  it('import from file shows preview summary, then adds the places', async () => {
    const user = userEvent.setup();
    const { storage, store } = await open();
    await user.click(screen.getByRole('button', { name: '옛 여행 가져오기' }));

    await user.upload(within(dialog()).getByLabelText('파일 선택(.json)'), jsonFile(tripOf()));
    expect(
      await within(dialog()).findByText(
        '새로 추가 2 · 이미 있음 0(라벨만 합침) · 새 라벨 1 · 확인 필요 0',
      ),
    ).toBeInTheDocument();

    await user.click(within(dialog()).getByRole('button', { name: '가져오기' }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('2곳을 가져왔어요'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '옛 여행 가져오기' })).not.toBeInTheDocument(),
    );
    expect(Object.keys(stored(storage).places)).toHaveLength(7);
    expect(Object.keys(store.get(libraryAtom).places)).toHaveLength(7);
    expect(screen.getByText('장소 7곳 · 라벨 4개', { exact: false })).toBeInTheDocument();
  });

  it('import from a pasted link reads /data/<publicId>.json; errors stay in the dialog', async () => {
    const user = userEvent.setup();
    const fetchMock = stubTripFetch({ testtrip0001: tripOf() });
    await open();
    await user.click(screen.getByRole('button', { name: '옛 여행 가져오기' }));
    const input = within(dialog()).getByRole('textbox', { name: '링크 붙여넣기' });

    await user.type(input, 'https://example.com/t/nothere0001');
    await user.click(within(dialog()).getByRole('button', { name: '불러오기' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      '여행 데이터를 찾지 못했어요',
    );

    await user.clear(input);
    await user.type(input, '/t/testtrip0001');
    await user.click(within(dialog()).getByRole('button', { name: '불러오기' }));
    expect(
      await within(dialog()).findByText(
        '새로 추가 2 · 이미 있음 0(라벨만 합침) · 새 라벨 1 · 확인 필요 0',
      ),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith('/data/testtrip0001.json');
  });

  it('a file that is not a trip shows the reader message in the dialog', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: '옛 여행 가져오기' }));
    await user.upload(
      within(dialog()).getByLabelText('파일 선택(.json)'),
      new File(['{not json'], 'trip.json', { type: 'application/json' }),
    );
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      'JSON을 해석하지 못했어요',
    );
  });
});
