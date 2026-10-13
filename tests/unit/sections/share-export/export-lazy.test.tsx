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
  it('열면 파일을 받은 뒤 대화상자가 나타나고, 닫았다 다시 열어도 그대로 열린다', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' }, preloadPanels: false });
    await user.click(screen.getByRole('button', { name: '내보내기' }));
    expect(screen.queryByRole('dialog', { name: '내보내기' })).not.toBeInTheDocument();

    gate.open();
    const dialog = await screen.findByRole('dialog', { name: '내보내기' });
    expect(within(dialog).getByText('지금 보이는 5곳을 내보냅니다')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '내보내기' }));
    expect(await screen.findByRole('dialog', { name: '내보내기' })).toBeInTheDocument();
  });
});
