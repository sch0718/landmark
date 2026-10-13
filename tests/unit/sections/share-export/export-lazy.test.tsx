import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { renderLibrary, sampleLibrary } from '../library/fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

// 내보내기 대화상자 파일 받기를 문으로 붙잡아, 열었을 때 받을 때까지 나타나지 않는 것을 본다.
const gate = vi.hoisted(() => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
});
vi.mock('src/sections/share-export/ExportHtmlDialog', async (importOriginal) => {
  await gate.opened;
  return importOriginal();
});

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

describe('내보내기 대화상자 나눠 받기', () => {
  it('열면 받는 동안 기다림 대화상자가 뜨고 받으면 실제 대화상자로 바뀌며, 닫았다 다시 열어도 그대로 열린다', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' }, preloadPanels: false });
    await user.click(screen.getByRole('button', { name: '내보내기' }));
    // 받는 동안에도 같은 제목의 대화상자가 기다림 표시와 닫기 버튼을 보인다.
    const waiting = await screen.findByRole('dialog', { name: '내보내기' });
    expect(within(waiting).getByText('불러오는 중…')).toHaveAttribute('role', 'status');
    expect(within(waiting).queryByText('지금 보이는 5곳을 내보냅니다')).not.toBeInTheDocument();

    // 받는 중에도 닫을 수 있고, 다시 열면 같은 기다림 화면이다.
    await user.click(within(waiting).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '내보내기' }));
    expect(
      within(await screen.findByRole('dialog', { name: '내보내기' })).getByText('불러오는 중…'),
    ).toBeInTheDocument();

    gate.open();
    expect(await screen.findByText('지금 보이는 5곳을 내보냅니다')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog', { name: '내보내기' });
    expect(within(dialog).queryByText('불러오는 중…')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '내보내기' }));
    expect(await screen.findByRole('dialog', { name: '내보내기' })).toBeInTheDocument();
  });
});
