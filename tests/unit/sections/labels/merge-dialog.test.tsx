import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MergeDialog } from 'src/sections/labels/MergeDialog';
import { makeLabel } from '../library/fixtures';

afterEach(cleanup);

const LONG = '신세계 정용진이 모은 맛집-강원 강릉 순두부';

/** jsdom은 배치를 하지 않아 넘침 크기가 0이다. 잘린 것처럼 보이게 크기를 심는다. */
function fakeOverflow(el: HTMLElement) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 100 });
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: 240 });
}

describe('MergeDialog 말줄임 툴팁', () => {
  it('잘린 라벨 툴팁을 띄운 채 Esc를 누르면 툴팁만 닫히고 대화상자는 남는다. 한 번 더 누르면 대화상자가 닫힌다', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <MergeDialog
        from={makeLabel('label001', '맛집', 'red', 'utensils', 0)}
        targets={[makeLabel('label002', LONG, 'blue', 'waves', 1)]}
        counts={new Map()}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    fakeOverflow(within(dialog).getByText(LONG));

    // 대화상자가 처음 포커스를 둔 곳에서 Tab으로 잘린 라벨 단추에 키보드 포커스를 준다.
    const radio = within(dialog).getByRole('radio', { name: LONG });
    while (document.activeElement !== radio) await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(LONG);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
