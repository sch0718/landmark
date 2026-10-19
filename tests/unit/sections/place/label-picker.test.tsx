import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Label } from 'src/schema/library';
import { LabelPicker } from 'src/sections/place/LabelPicker';
import { libraryAtom } from 'src/stores/library-state';
import { attachedNames, openLabelPicker } from '../../helpers/label-picker';
import { L_CAFE, L_SEA, sampleLibrary } from '../library/fixtures';
import { mockViewport } from '../shell/harness';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(attachedIds: string[]) {
  mockViewport(1280);
  const library = sampleLibrary();
  const store = createStore();
  store.set(libraryAtom, library);
  const labels = Object.values(library.labels).sort(
    (a, b) => a.order.value - b.order.value,
  ) as Label[];
  const onToggle = vi.fn();
  render(
    <Provider store={store}>
      <section aria-label="칸">
        <LabelPicker
          labels={labels}
          attachedIds={attachedIds}
          onToggle={onToggle}
          onCreate={vi.fn()}
        />
      </section>
    </Provider>,
  );
  return { onToggle, scope: screen.getByRole('region', { name: '칸' }) };
}

describe('LabelPicker', () => {
  it('붙은 라벨만 라벨 순서대로 보인다', () => {
    const { scope } = setup([L_SEA, L_CAFE]);
    expect(attachedNames(scope)).toEqual(['카페', '바다뷰']);
    expect(within(scope).queryByRole('checkbox')).toBeNull();
    expect(within(scope).queryByRole('textbox')).toBeNull();
  });

  it('붙은 라벨이 없으면 알린다', () => {
    const { scope } = setup([]);
    expect(within(scope).getByText('붙은 라벨이 없어요')).toBeInTheDocument();
  });

  it('라벨 바꾸기를 누르면 고르기 창이 열리고, 체크가 onToggle로 간다', async () => {
    const user = userEvent.setup();
    const { scope, onToggle } = setup([L_SEA]);
    const button = within(scope).getByRole('button', { name: '라벨 바꾸기' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    const dialog = await openLabelPicker(user, scope);
    await user.click(within(dialog).getByRole('checkbox', { name: /^카페/ }));
    expect(onToggle).toHaveBeenCalledWith(L_CAFE);
    await user.click(within(dialog).getByRole('button', { name: '완료' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(button).toHaveFocus();
  });
});
