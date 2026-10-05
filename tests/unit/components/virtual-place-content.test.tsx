import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { VirtualizerOptions } from '@tanstack/react-virtual';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VirtualPlaceRows } from 'src/sections/explore/view/VirtualPlaceRows';
import { ViewScrollContext } from 'src/sections/views/view-scroll-context';

const range = vi.hoisted(() => ({
  indexes: [0, 1],
  shift: 0,
  getItemKey: (index: number): string | number | bigint => index,
  virtualizer: {
    getVirtualItems: () =>
      range.indexes.map((index) => ({
        index,
        key: range.getItemKey(index),
        start: index * 170 + range.shift,
        end: (index + 1) * 170 + range.shift,
        size: 170,
        lane: 0,
      })),
    getTotalSize: () => 80 * 170 + range.shift,
    measureElement: vi.fn(),
    measure: vi.fn(),
    getVirtualItemForOffset: () => undefined,
    takeSnapshot: () => [],
  },
}));

vi.mock('@tanstack/react-virtual', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-virtual')>();
  const { useEffect, useReducer } = await import('react');
  return {
    ...original,
    useVirtualizer: (
      options: Pick<
        VirtualizerOptions<HTMLDivElement, HTMLElement>,
        'getItemKey' | 'getScrollElement'
      >,
    ) => {
      const [, update] = useReducer((value: number) => value + 1, 0);
      range.getItemKey = options.getItemKey!;
      const host = options.getScrollElement();
      useEffect(() => {
        host?.addEventListener('scroll', update);
        return () => host?.removeEventListener('scroll', update);
      }, [host]);
      return range.virtualizer;
    },
  };
});

beforeEach(() => {
  range.indexes = [0, 1];
  range.shift = 0;
  vi.clearAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 160, 170));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(renderPlace: (key: string) => ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const context = { ref: { current: host }, element: host, view: 'places' as const };
  const store = createStore();
  const keys = Array.from({ length: 80 }, (_, index) => `place-${index}`);
  const content = {};
  const draw = (callback: typeof renderPlace) => (
    <Provider store={store}>
      <ViewScrollContext value={context}>
        <VirtualPlaceRows
          keys={keys}
          variant="list"
          content={content}
          ready
          renderPlace={callback}
        />
      </ViewScrollContext>
    </Provider>
  );
  const view = render(draw(renderPlace), { container: host });
  return { host, view, draw };
}

it('측정 목록의 스크롤 갱신은 유지된 내용 렌더를 건너뛰고 새 key를 렌더한다', () => {
  const renderPlace = vi.fn((key: string) => <button>{key}</button>);
  const { host, view } = mount(renderPlace);
  try {
    expect(host.querySelector('[data-place-count="80"]')).toBeInTheDocument();
    expect(renderPlace.mock.calls.map(([key]) => key)).toEqual(['place-0', 'place-1']);
    const retained = screen.getByRole('button', { name: 'place-1' });
    const row = retained.closest('[data-index="1"]')!;
    expect(range.virtualizer.measureElement).toHaveBeenCalledWith(row);
    renderPlace.mockClear();
    act(() => {
      range.indexes = [1, 2];
      range.shift = 25;
      host.scrollTop = 170;
      fireEvent.scroll(host);
    });
    expect(screen.queryByRole('button', { name: 'place-0' })).toBeNull();
    expect(screen.getByRole('button', { name: 'place-1' })).toBe(retained);
    expect(screen.getByRole('button', { name: 'place-2' })).toBeInTheDocument();
    expect(getComputedStyle(row).transform).toBe('translateY(195px)');
    expect(renderPlace.mock.calls.map(([key]) => key)).toEqual(['place-2']);
    renderPlace.mockClear();
    act(() => {
      range.shift = 50;
      fireEvent.scroll(host);
    });
    expect(getComputedStyle(row).transform).toBe('translateY(220px)');
    expect(renderPlace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'place-1' })).toBe(retained);
  } finally {
    view.unmount();
    host.remove();
  }
});

it('측정 목록의 renderPlace identity 변경은 유지 노드의 내용과 click handler를 갱신한다', () => {
  const oldClick = vi.fn(),
    nextClick = vi.fn();
  const first = vi.fn((key: string) => (
    <button onClick={oldClick}>{key}: 첫 요약 / 1일 / 메모</button>
  ));
  const second = vi.fn((key: string) => (
    <button onClick={nextClick}>{key}: 새 요약 / 2일 / 새 메모</button>
  ));
  const { host, view, draw } = mount(first);
  try {
    const retained = screen.getByRole('button', { name: 'place-1: 첫 요약 / 1일 / 메모' });
    fireEvent.click(retained);
    expect(oldClick).toHaveBeenCalledTimes(1);
    view.rerender(draw(second));
    const updated = screen.getByRole('button', { name: 'place-1: 새 요약 / 2일 / 새 메모' });
    expect(updated).toBe(retained);
    expect(screen.queryByText('place-1: 첫 요약 / 1일 / 메모')).toBeNull();
    expect(second.mock.calls.map(([key]) => key)).toEqual(['place-0', 'place-1']);
    fireEvent.click(updated);
    expect(nextClick).toHaveBeenCalledTimes(1);
    expect(oldClick).toHaveBeenCalledTimes(1);
    second.mockClear();
    act(() => {
      range.shift = 10;
      fireEvent.scroll(host);
    });
    expect(second).not.toHaveBeenCalled();
    fireEvent.click(updated);
    expect(nextClick).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
    host.remove();
  }
});
