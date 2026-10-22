import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Label } from 'src/schema/library';
import { ruleValue } from '../../components/helpers/rule-style';
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
  onToggle = vi.fn(),
}: {
  attachedIds?: string[];
  onCreate?: (name: string) => Promise<LibraryActionResult>;
  width?: number;
  onToggle?: (labelId: string) => void | Promise<LibraryActionResult>;
} = {}) {
  mockViewport(width);
  const library = sampleLibrary();
  const store = createStore();
  store.set(libraryAtom, library);
  const labels = Object.values(library.labels).sort(
    (a, b) => a.order.value - b.order.value,
  ) as Label[];
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

  it('체크는 저장이 끝나기 전에도 바로 보이고, 저장된 값이 따라오면 그대로, 다시 열면 저장된 값을 보인다', async () => {
    const { rerender, view } = setup();
    const cafe = () => within(dialog()).getByRole('checkbox', { name: /^카페/ });
    const sea = () => within(dialog()).getByRole('checkbox', { name: /^바다뷰/ });
    // onToggle이 attachedIds를 바꾸지 않아도(저장 중) 체크가 되돌아가지 않는다.
    await userEvent.click(cafe());
    expect(cafe()).toBeChecked();
    await userEvent.click(sea());
    expect(sea()).not.toBeChecked();
    // 저장이 끝나 attachedIds가 같아진다.
    rerender(view(true, [L_CAFE]));
    expect(cafe()).toBeChecked();
    expect(sea()).not.toBeChecked();
    // 맞춰진 뒤에는 저장된 값을 따른다(남은 체크 표시가 없다).
    rerender(view(true, [L_SEA]));
    expect(cafe()).not.toBeChecked();
    expect(sea()).toBeChecked();
    // 저장되지 않은 체크가 남은 채 닫았다가 다시 열면 저장된 값으로 보인다.
    await userEvent.click(cafe());
    expect(cafe()).toBeChecked();
    rerender(view(false, [L_SEA]));
    rerender(view(true, [L_SEA]));
    expect(cafe()).not.toBeChecked();
  });

  it('저장이 실패하면(onToggle이 ok: false로 끝남) 누른 체크를 저장된 값으로 되돌린다', async () => {
    let finish!: (result: LibraryActionResult) => void;
    const onToggle = vi.fn(() => new Promise<LibraryActionResult>((resolve) => (finish = resolve)));
    setup({ onToggle });
    const cafe = () => within(dialog()).getByRole('checkbox', { name: /^카페/ });
    await userEvent.click(cafe());
    expect(cafe()).toBeChecked();
    await act(async () => {
      finish({ ok: false, error: new Error('저장소 오류') } as LibraryActionResult);
    });
    expect(cafe()).not.toBeChecked();
  });

  it('창을 다시 연 뒤에 끝난 실패는 새 체크를 건드리지 않는다', async () => {
    const finishes: ((result: LibraryActionResult) => void)[] = [];
    const onToggle = vi.fn(
      () => new Promise<LibraryActionResult>((resolve) => finishes.push(resolve)),
    );
    const { rerender, view } = setup({ onToggle });
    const cafe = () => within(dialog()).getByRole('checkbox', { name: /^카페/ });
    await userEvent.click(cafe());
    rerender(view(false));
    rerender(view(true));
    await userEvent.click(cafe());
    expect(cafe()).toBeChecked();
    await act(async () => {
      finishes[0]!({ ok: false, error: new Error('x') } as LibraryActionResult);
    });
    expect(cafe()).toBeChecked();
  });

  it('다시 열면 그때의 붙은 라벨 기준으로 순서를 새로 정한다', () => {
    const { rerender, view } = setup();
    rerender(view(false, [L_CAFE]));
    rerender(view(true, [L_CAFE]));
    expect(rowNames()).toEqual(['카페', '맛집', '바다뷰']);
  });

  it('닫히는 동안에도 순서와 개수를 그대로 보인다', () => {
    const { rerender, view } = setup();
    rerender(view(false, [L_SEA, L_CAFE]));
    // 페이드 아웃 동안 창은 아직 DOM에 있다.
    expect(rowNames()).toEqual(['바다뷰', '맛집', '카페']);
    expect(within(dialog()).getByRole('checkbox', { name: /^맛집/ })).toHaveAccessibleName(
      '맛집 2곳',
    );
  });

  it('만드는 중에 Enter를 또 눌러도 한 번만 만든다', async () => {
    let finish!: (result: LibraryActionResult) => void;
    const onCreate = vi.fn(() => new Promise<LibraryActionResult>((resolve) => (finish = resolve)));
    setup({ onCreate });
    const search = screen.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' });
    await userEvent.type(search, '야시장{Enter}{Enter}');
    expect(onCreate).toHaveBeenCalledTimes(1);
    finish({ ok: true });
    await waitFor(() => expect(search).toHaveValue(''));
    await userEvent.type(search, '국밥{Enter}');
    expect(onCreate).toHaveBeenCalledTimes(2);
  });

  it('검색어로 거르고, 맞는 게 없으면 알린다', async () => {
    setup();
    const search = screen.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' });
    expect(search).toHaveFocus();
    await userEvent.type(search, '맛');
    expect(rowNames()).toEqual(['맛집']);
    await userEvent.clear(search);
    await userEvent.type(search, '없는이름');
    expect(within(dialog()).getByText('‘없는이름’에 맞는 라벨이 없어요')).toBeInTheDocument();
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

  it('장소가 사라져 거절되면 알리고, 알 수 없는 오류(토스트로 알림)는 칸 아래에 보이지 않는다', async () => {
    const { unmount } = setup({
      onCreate: vi.fn(async () => ({
        ok: false as const,
        error: { _tag: 'NotFound', id: 'place00001' },
      })) as unknown as (name: string) => Promise<LibraryActionResult>,
    });
    const search = () => screen.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' });
    await userEvent.type(search(), '야시장{Enter}');
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('장소를 찾을 수 없어요');
    unmount();

    const onCreate = vi.fn(async () => ({ ok: false as const, error: new Error('x') }));
    setup({ onCreate: onCreate as unknown as (name: string) => Promise<LibraryActionResult> });
    await userEvent.type(search(), '야시장{Enter}');
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(within(dialog()).queryByRole('alert')).toBeNull();
    expect(search()).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('검색 칸은 16px·높이 44px(아이폰에서 눌러도 확대되지 않는다)이다', () => {
    setup();
    const search = screen.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' });
    expect(ruleValue(search, 'font-size')).toBe('16px');
    expect(ruleValue(search, 'min-height')).toBe('44px');
  });

  it('완료로 닫는다', async () => {
    const { onClose } = setup();
    await userEvent.click(within(dialog()).getByRole('button', { name: '완료' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('열림 전환이 끝나면 포커스 트랩이 가져간 포커스를 넓은 화면의 검색 칸으로 되돌린다', async () => {
    setup();
    const search = screen.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' });
    // 실제 브라우저에서 포커스 트랩이 창으로 포커스를 옮긴 상황을 흉내 낸다.
    search.blur();
    expect(search).not.toHaveFocus();
    await waitFor(() => expect(search).toHaveFocus());
  });

  it('휴대폰은 화면 전체로 열고 검색 칸에 포커스를 두지 않는다', () => {
    setup({ width: 390 });
    expect(
      screen.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' }),
    ).not.toHaveFocus();
  });
});

it('생성 모듈을 받지 못하면 입력을 보존하고 다시 시도할 수 있다', async () => {
  const user = userEvent.setup();
  const onCreate = vi
    .fn<(name: string) => Promise<LibraryActionResult>>()
    .mockRejectedValueOnce(new Error('화면 파일 없음'))
    .mockResolvedValue({ ok: true });
  setup({ onCreate });
  const search = within(dialog()).getByRole('searchbox');
  await user.type(search, '빵집{Enter}');
  expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
    '라벨을 만들지 못했어요. 다시 시도해 주세요',
  );
  expect(search).toHaveValue('빵집');
  await user.keyboard('{Enter}');
  await waitFor(() => expect(search).toHaveValue(''));
  expect(onCreate).toHaveBeenCalledTimes(2);
});
