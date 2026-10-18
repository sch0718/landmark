import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Label } from 'src/schema/library';
import { LabelPickerDialog } from 'src/sections/place/LabelPickerDialog';
import { libraryAtom, type LibraryActionResult } from 'src/stores/library-state';
import { L_CAFE, L_SEA, sampleLibrary } from '../library/fixtures';
import { mockViewport } from '../shell/harness';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup({
  attachedIds = [L_SEA],
  onCreate = vi.fn(async (): Promise<LibraryActionResult> => ({ ok: true }) as LibraryActionResult),
  width = 1280,
}: {
  attachedIds?: string[];
  onCreate?: (name: string) => Promise<LibraryActionResult>;
  width?: number;
} = {}) {
  mockViewport(width);
  const library = sampleLibrary();
  const store = createStore();
  store.set(libraryAtom, library);
  const labels = Object.values(library.labels).sort(
    (a, b) => a.order.value - b.order.value,
  ) as Label[];
  const onToggle = vi.fn();
  const onClose = vi.fn();
  const view = (open: boolean, ids = attachedIds) => (
    <Provider store={store}>
      <LabelPickerDialog
        open={open}
        onClose={onClose}
        labels={labels}
        attachedIds={ids}
        onToggle={onToggle}
        onCreate={onCreate}
      />
    </Provider>
  );
  const utils = render(view(true));
  return { ...utils, view, onToggle, onClose, onCreate, labels };
}

const dialog = () => screen.getByRole('dialog', { name: '라벨 바꾸기' });
const rowNames = () =>
  within(within(dialog()).getByRole('group', { name: '라벨 목록' }))
    .getAllByRole('checkbox')
    .map((box) => box.closest('label')!.querySelector('[data-label-name]')!.textContent);

describe('LabelPickerDialog', () => {
  it('붙은 라벨이 먼저, 나머지는 많이 쓴 순이고 개수를 보인다', () => {
    setup();
    // 샘플: 맛집 2곳, 카페 1곳, 바다뷰 1곳. 바다뷰가 붙어 있다.
    expect(rowNames()).toEqual(['바다뷰', '맛집', '카페']);
    expect(within(dialog()).getByRole('checkbox', { name: /^바다뷰/ })).toBeChecked();
    expect(within(dialog()).getByRole('checkbox', { name: /^맛집/ })).toHaveAccessibleName(
      '맛집 2곳',
    );
  });

  it('체크하면 바로 onToggle을 부르고, 열려 있는 동안 순서는 그대로다', async () => {
    const { rerender, view, onToggle } = setup();
    await userEvent.click(within(dialog()).getByRole('checkbox', { name: /^카페/ }));
    expect(onToggle).toHaveBeenCalledWith(L_CAFE);
    rerender(view(true, [L_SEA, L_CAFE]));
    expect(rowNames()).toEqual(['바다뷰', '맛집', '카페']);
    expect(within(dialog()).getByRole('checkbox', { name: /^카페/ })).toBeChecked();
  });

  it('다시 열면 그때의 붙은 라벨 기준으로 순서를 새로 정한다', () => {
    const { rerender, view } = setup();
    rerender(view(false, [L_CAFE]));
    rerender(view(true, [L_CAFE]));
    expect(rowNames()).toEqual(['카페', '맛집', '바다뷰']);
  });

  it('검색어로 거르고, 맞는 게 없으면 알린다', async () => {
    setup();
    const search = screen.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' });
    expect(search).toHaveFocus();
    await userEvent.type(search, '맛');
    expect(rowNames()).toEqual(['맛집']);
    await userEvent.clear(search);
    await userEvent.type(search, '없는이름');
    expect(within(dialog()).getByText('‘없는이름’와 맞는 라벨이 없어요')).toBeInTheDocument();
  });

  it('같은 이름이 없으면 새 라벨 행이 생기고, 누르거나 Enter로 만든다', async () => {
    const { onCreate } = setup();
    const search = screen.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' });
    await userEvent.type(search, '맛집');
    expect(within(dialog()).queryByRole('button', { name: /새 라벨로 붙이기/ })).toBeNull();
    await userEvent.clear(search);
    await userEvent.type(search, '야시장');
    await userEvent.click(
      within(dialog()).getByRole('button', { name: '‘야시장’ 새 라벨로 붙이기' }),
    );
    expect(onCreate).toHaveBeenCalledWith('야시장');
    await waitFor(() => expect(search).toHaveValue(''));

    await userEvent.type(search, '국밥{Enter}');
    expect(onCreate).toHaveBeenLastCalledWith('국밥');
  });

  it('한글 조합 중 Enter는 무시한다', () => {
    const { onCreate } = setup();
    const search = screen.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' });
    fireEvent.change(search, { target: { value: '야시' } });
    fireEvent.keyDown(search, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('거절 이유를 검색 칸 아래에 보이고 입력은 남긴다', async () => {
    setup({
      onCreate: vi.fn(async () => ({
        ok: false as const,
        error: { _tag: 'LabelNameTaken', name: '야시장' },
      })) as unknown as (name: string) => Promise<LibraryActionResult>,
    });
    const search = screen.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' });
    await userEvent.type(search, '야시장{Enter}');
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      '같은 이름의 라벨이 있어요',
    );
    expect(search).toHaveAttribute('aria-invalid', 'true');
    expect(search).toHaveValue('야시장');
  });

  it('완료로 닫는다', async () => {
    const { onClose } = setup();
    await userEvent.click(within(dialog()).getByRole('button', { name: '완료' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('휴대폰은 화면 전체로 열고 검색 칸에 포커스를 두지 않는다', () => {
    setup({ width: 390 });
    expect(
      screen.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' }),
    ).not.toHaveFocus();
  });
});
