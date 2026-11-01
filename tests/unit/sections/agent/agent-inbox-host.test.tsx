import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { ChunkLoadError } from 'src/lib/lazy-chunk';
import { agentInboxOpenAtom } from 'src/stores/agent-inbox';
import { mockViewport, renderApp } from '../shell/harness';

const { loadDialog } = vi.hoisted(() => ({ loadDialog: vi.fn() }));
vi.mock('src/services/agent-inbox/boot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('src/services/agent-inbox/boot')>()),
  loadAgentInboxDialog: loadDialog,
}));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('받은함 조각 오류를 창 안에 보여 주고 닫아도 셸을 유지해요', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  loadDialog.mockRejectedValue(new ChunkLoadError('화면 파일을 받지 못했어요'));
  mockViewport(1280);
  const user = userEvent.setup();
  const { store } = await renderApp();
  expect(loadDialog).not.toHaveBeenCalled();
  await act(async () => store.set(agentInboxOpenAtom, true));
  await screen.findByRole('alert');
  const dialog = screen.queryByRole('dialog', { name: 'AI가 보낸 일정' });
  expect(dialog).toBeInTheDocument();
  expect(within(dialog!).getByRole('alert')).toHaveTextContent(
    '새 버전이 나왔어요. 새로고침해 주세요',
  );
  expect(within(dialog!).getByRole('button', { name: '새로고침' })).toBeInTheDocument();
  const close = within(dialog!).getByRole('button', { name: '닫기' });
  expect(Number.parseFloat(getComputedStyle(close).minHeight)).toBeGreaterThanOrEqual(44);
  await user.click(close);
  expect(store.get(agentInboxOpenAtom)).toBe(false);
  expect(screen.queryByRole('dialog', { name: 'AI가 보낸 일정' })).not.toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: '사이드 메뉴' })).toBeInTheDocument();
  await act(async () => store.set(agentInboxOpenAtom, true));
  expect(await screen.findByRole('dialog', { name: 'AI가 보낸 일정' })).toBeInTheDocument();
});
