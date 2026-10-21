import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUERY } from 'src/domain/library/query';
import { LabelChips } from 'src/sections/library/LabelChips';
import { ChipScrollRow } from 'src/sections/library/ChipScrollRow';
import { RegionChips } from 'src/sections/library/RegionChips';
import { makeLabel } from './fixtures';

const layout = vi.hoisted(() => ({ value: 'wide' }));
vi.mock('src/sections/shell/use-layout', () => ({ useLayout: () => layout.value }));
afterEach(() => {
  layout.value = 'wide';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const labels = Array.from({ length: 13 }, (_, i) =>
  makeLabel(`label${String(i).padStart(5, '0')}`, `맛집 ${i}`, 'red', 'star', i),
);
const counts = new Map(labels.map((l, i) => [l.id, i + 1]));
function Harness({ size = 13 }: { size?: number }) {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  return (
    <MemoryRouter>
      <LabelChips
        labels={labels.slice(0, size)}
        counts={counts}
        query={query}
        onChange={(patch) => setQuery((q) => ({ ...q, ...patch }))}
      />
      <output aria-label="선택값">{JSON.stringify(query)}</output>
    </MemoryRouter>
  );
}

describe('많은 라벨 찾기', () => {
  it('12개까지는 버튼을 숨기고 13개부터 보여 준다', () => {
    const { unmount } = render(<Harness size={12} />);
    expect(screen.queryByRole('button', { name: '라벨 찾기' })).not.toBeInTheDocument();
    unmount();
    render(<Harness />);
    expect(screen.getByRole('button', { name: '라벨 찾기' })).toBeInTheDocument();
  });
  it('검색·많은 순·다중 체크와 모드가 기존 거르기를 즉시 바꾼다', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '라벨 찾기' }));
    await screen.findByRole('searchbox', { name: '라벨 이름 검색' });
    const dialog = screen.getByRole('dialog', { name: '라벨 찾기' });
    await user.selectOptions(within(dialog).getByRole('combobox', { name: '라벨 정렬' }), 'count');
    expect(within(dialog).getAllByRole('checkbox')[0]).toHaveAccessibleName('맛집 12 13곳');
    const search = within(dialog).getByRole('searchbox', { name: '라벨 이름 검색' });
    await user.type(search, '맛집 1');
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(4);
    await user.click(within(dialog).getByRole('checkbox', { name: '맛집 12 13곳' }));
    await user.click(within(dialog).getByRole('checkbox', { name: '맛집 10 11곳' }));
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: '라벨 포함 조건' }),
      'all',
    );
    expect(screen.getByLabelText('선택값')).toHaveTextContent('"mode":"all"');
    await user.click(within(dialog).getByRole('button', { name: '완료' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const buttons = within(screen.getByRole('group', { name: '라벨' })).getAllByRole('button');
    expect(buttons[2]).toHaveTextContent('맛집 10');
    expect(buttons[3]).toHaveTextContent('맛집 12');
    expect(buttons[2]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '라벨 찾기' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '라벨 찾기' }));
    expect(await screen.findByRole('searchbox', { name: '라벨 이름 검색' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: '라벨 정렬' })).toHaveValue('order');
  });
  it('휴대폰은 아래 시트이고 키보드로 체크·닫기를 할 수 있다', async () => {
    layout.value = 'compact';
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '라벨 찾기' }));
    await screen.findByRole('searchbox', { name: '라벨 이름 검색' });
    const dialog = screen.getByRole('dialog', { name: '라벨 찾기' });
    expect(dialog).toHaveAttribute('data-sheet', 'true');
    const checkbox = within(dialog).getAllByRole('checkbox')[0]!;
    act(() => checkbox.focus());
    await user.keyboard(' ');
    expect(checkbox).toBeChecked();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('넘칠 때만 칩 스크롤 버튼', () => {
  it('크기·스크롤 변경을 관찰하고 끝 방향을 비활성화한다', async () => {
    let resize = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          resize = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    render(
      <ChipScrollRow label="시험 줄">
        <span>내용</span>
      </ChipScrollRow>,
    );
    expect(
      screen.queryByRole('button', { name: '시험 줄 오른쪽으로 스크롤' }),
    ).not.toBeInTheDocument();
    const row = screen.getByRole('group', { name: '시험 줄' });
    Object.defineProperties(row, {
      clientWidth: { configurable: true, value: 200 },
      scrollWidth: { configurable: true, value: 600 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
    });
    row.scrollBy = vi.fn();
    act(() => resize());
    expect(screen.getByRole('button', { name: '시험 줄 왼쪽으로 스크롤' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '시험 줄 오른쪽으로 스크롤' }));
    expect(row.scrollBy).toHaveBeenCalled();
    row.scrollLeft = 400;
    fireEvent.scroll(row);
    expect(screen.getByRole('button', { name: '시험 줄 오른쪽으로 스크롤' })).toBeDisabled();
    // 단추가 차지하던 88px까지 포함한 전체 줄에는 내용이 들어가면 단추를 지운다.
    Object.defineProperty(row.parentElement, 'clientWidth', { configurable: true, value: 650 });
    Object.defineProperty(row, 'clientWidth', { configurable: true, value: 562 });
    act(() => resize());
    expect(
      screen.queryByRole('button', { name: '시험 줄 오른쪽으로 스크롤' }),
    ).not.toBeInTheDocument();
  });
});

it('시·도 전체 다음 시·군을 선택하고 옛 선택과 0곳 선택도 해제한다', async () => {
  const user = userEvent.setup();
  function Regions() {
    const [selected, setSelected] = useState<string[]>(['옛지역']);
    return (
      <>
        <RegionChips
          regions={[
            {
              region: '강원',
              count: 3,
              children: [
                { region: '강원/강릉', count: 2 },
                { region: '강원/속초', count: 1 },
              ],
            },
          ]}
          selected={selected}
          onChange={setSelected}
        />
        <output aria-label="선택 지역">{selected.join(',')}</output>
      </>
    );
  }
  render(<Regions />);
  await user.click(screen.getByRole('button', { name: '옛지역 0' }));
  await user.click(screen.getByRole('button', { name: '강원 3' }));
  expect(screen.getByLabelText('선택 지역')).toHaveTextContent('강원');
  await user.click(screen.getByRole('button', { name: '강릉 2' }));
  expect(screen.getByLabelText('선택 지역')).toHaveTextContent('강원/강릉');
  await user.click(screen.getByRole('button', { name: '강릉 2' }));
  expect(screen.getByLabelText('선택 지역')).toHaveTextContent('');
});
