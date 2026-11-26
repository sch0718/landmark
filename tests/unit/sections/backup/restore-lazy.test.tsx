import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RestoreDialogHost } from 'src/sections/backup/RestoreDialogHost';

vi.mock('src/sections/backup/RestoreDialog', () => new Promise(() => {}));

afterEach(cleanup);

it('백업 복원 창을 불러오는 중에도 제목을 표시하고 취소할 수 있다', async () => {
  const onClose = vi.fn();
  render(<RestoreDialogHost open onClose={onClose} mode="normal" />);

  const dialog = await screen.findByRole('dialog', { name: '백업에서 되살리기' });
  expect(within(dialog).getByRole('status')).toHaveTextContent('불러오는 중…');
  await userEvent.setup().click(within(dialog).getByRole('button', { name: '취소' }));
  expect(onClose).toHaveBeenCalledOnce();
});
