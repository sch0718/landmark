import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LabelPicker } from 'src/sections/place/LabelPicker';
import type { LibraryActionResult } from 'src/stores/library-state';

afterEach(cleanup);

async function submit(result: LibraryActionResult) {
  const onCreate = vi.fn(async () => result);
  render(<LabelPicker labels={[]} attachedIds={[]} onToggle={vi.fn()} onCreate={onCreate} />);
  const input = screen.getByPlaceholderText('새 라벨 이름');
  fireEvent.change(input, { target: { value: '야시장' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(onCreate).toHaveBeenCalled());
  return input;
}

describe('LabelPicker rejections', () => {
  it('shows a taken-name message', async () => {
    const input = await submit({ ok: false, error: { _tag: 'LabelNameTaken', name: '야시장' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('같은 이름의 라벨이 있어요');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveValue('야시장'); // 입력은 남겨 고칠 수 있게 한다.
  });

  it('shows a not-found message when the place is gone', async () => {
    await submit({ ok: false, error: { _tag: 'NotFound', id: 'place00001' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('장소를 찾을 수 없어요');
  });

  it('shows nothing for errors that were already reported as a toast', async () => {
    await submit({ ok: false, error: new Error('저장소 오류') });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
