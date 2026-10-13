import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { renderLibrary, sampleLibrary } from '../library/fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));
// 새 배포 뒤 옛 파일이 없는 경우처럼, 내보내기 대화상자 파일 받기가 실패한다.
vi.mock('src/sections/share-export/ExportHtmlDialog', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NOTICE = '새 버전이 나왔어요. 새로고침해 주세요';

async function openExport(user: ReturnType<typeof userEvent.setup>) {
  await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' }, preloadPanels: false });
  await user.click(screen.getByRole('button', { name: '내보내기' }));
  // 기다림 틀이 먼저 뜨고 받기 실패 안내가 그것을 바꿔 놓는다.
  await screen.findByText(NOTICE);
  return screen.getByRole('dialog', { name: '내보내기' });
}

describe('내보내기 대화상자 받기 실패', () => {
  it('대화상자 안에 새 버전 안내와 새로고침 버튼을 보인다', async () => {
    const user = userEvent.setup();
    const dialog = await openExport(user);
    expect(within(dialog).getByText(NOTICE)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '새로고침' })).toBeInTheDocument();
    expect(screen.queryByText('문제가 생겨 화면을 표시하지 못했어요')).not.toBeInTheDocument();
  });

  it('새로고침 버튼은 location.reload를 부른다', async () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    const user = userEvent.setup();
    const dialog = await openExport(user);
    fireEvent.click(within(dialog).getByRole('button', { name: '새로고침' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('닫기는 그대로 된다', async () => {
    const user = userEvent.setup();
    const dialog = await openExport(user);
    await user.click(within(dialog).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
