import { act, cleanup, render } from '@testing-library/react';
import type { VirtualizerOptions } from '@tanstack/react-virtual';
import { createStore, Provider } from 'jotai';
import { Fragment, StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VirtualPlaceRows } from 'src/sections/explore/view/VirtualPlaceRows';
import { cacheKey, virtualPlaceCacheAtom } from 'src/sections/explore/view/virtual-place-state';
import { ViewScrollContext } from 'src/sections/views/view-scroll-context';

const audit = vi.hoisted(() => ({ offsets: [] as number[], measurements: [] as unknown[] }));
vi.mock('@tanstack/react-virtual', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-virtual')>();
  const { useLayoutEffect, useState } = await import('react');
  return {
    ...original,
    useVirtualizer: (options: VirtualizerOptions<HTMLDivElement, HTMLElement>) => {
      const [initial] = useState(options);
      const [virtualizer] = useState(() => ({
        getVirtualItems: () => [],
        getTotalSize: () => 50000,
        getVirtualItemForOffset: () => undefined,
        takeSnapshot: () => [],
        measureElement: () => {},
      }));
      useLayoutEffect(() => {
        const offset = Number(initial.initialOffset ?? 0);
        audit.offsets.push(offset);
        audit.measurements.push(initial.initialMeasurementsCache);
        initial.getScrollElement()!.scrollTop = offset;
      }, [initial]);
      return virtualizer;
    },
  };
});
let width = 320;
const measures = new Set<ResizeObserverCallback>();
beforeEach(() => {
  width = 320;
  audit.offsets = [];
  audit.measurements = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {
        measures.add(callback);
      }
      observe() {}
      disconnect() {
        measures.delete(this.callback);
      }
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, width, 844),
  );
});
afterEach(() => {
  cleanup();
  measures.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture(strict = true) {
  const store = createStore(),
    content = {},
    keys = Array.from({ length: 61 }, (_, i) => String(i));
  const snapshot = [{ index: 0, key: '["0"]', start: 0, end: 170, size: 170, lane: 0 }];
  store.set(virtualPlaceCacheAtom, {
    places: { key: cacheKey('list', 390, 1, keys), content, offset: 29962, measurements: snapshot },
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const Wrapper = strict ? StrictMode : Fragment;
  const draw = (count = 61, target = host) => (
    <Wrapper>
      <Provider store={store}>
        <ViewScrollContext value={{ ref: { current: target }, element: target, view: 'places' }}>
          <VirtualPlaceRows
            keys={keys.slice(0, count)}
            variant="list"
            content={content}
            ready
            renderPlace={(key) => <button>{key}</button>}
          />
        </ViewScrollContext>
      </Provider>
    </Wrapper>
  );
  const view = render(draw(), { container: host });
  return { host, store, snapshot, draw, view };
}
function resize(next: number) {
  act(() => {
    width = next;
    for (const callback of [...measures]) callback([], {} as ResizeObserver);
  });
}
it.each([false, true])(
  '활성 host의 320→390 render는 cleanup 전 오래된 390 cache를 복원하지 않는다 (StrictMode=%s)',
  (strict) => {
    width = 390;
    const { host, view } = fixture(strict);
    expect(host.scrollTop).toBe(29962);
    resize(320);
    expect(host.scrollTop).toBe(0);
    host.scrollTop = 669;
    resize(390);
    expect(audit.offsets.at(-1)).toBe(0);
    expect(host.scrollTop).not.toBe(29962);
    resize(320);
    host.scrollTop = 733;
    resize(390);
    expect(audit.offsets.at(-1)).toBe(0);
    view.unmount();
    host.remove();
  },
);
it('호환 첫 진입과 같은 폭의 fresh view는 StrictMode에서도 offset과 측정을 복원한다', () => {
  width = 390;
  const { host, view, draw, snapshot } = fixture();
  expect(host.scrollTop).toBe(29962);
  expect(audit.measurements[0]).toEqual(snapshot);
  host.scrollTop = 1234;
  view.rerender(<Provider />);
  view.rerender(draw());
  expect(host.scrollTop).toBe(1234);
  view.unmount();
  host.remove();
});
it('60↔61 renderer 전환은 활성 host에서 이전 measured cache를 재소비하지 않는다', () => {
  width = 390;
  const { host, view, draw } = fixture();
  expect(host.scrollTop).toBe(29962);
  view.rerender(draw(60));
  view.rerender(draw());
  expect(audit.offsets.at(-1)).toBe(0);
  view.unmount();
  host.remove();
});

it('새 host는 같은 parent 수명에서도 호환 entry offset을 복원한다', () => {
  width = 390;
  const { host, view, draw } = fixture();
  const next = document.createElement('div');
  document.body.appendChild(next);
  host.scrollTop = 5432;
  view.rerender(draw(61, next));
  expect(next.scrollTop).toBe(5432);
  view.unmount();
  host.remove();
  next.remove();
});

it('정적 첫 진입 ready=false는 복원을 소비하지 않고 StrictMode ready=true에 valid cache를 복원한다', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 390 });
  const store = createStore(),
    content = {},
    keys = Array.from({ length: 60 }, (_, i) => String(i));
  store.set(virtualPlaceCacheAtom, {
    places: { key: cacheKey('list', 390, 1, keys), content, offset: 456, measurements: [] },
  });
  const draw = (ready: boolean) => (
    <StrictMode>
      <Provider store={store}>
        <ViewScrollContext value={{ ref: { current: host }, element: host, view: 'places' }}>
          <VirtualPlaceRows
            keys={keys}
            content={content}
            variant="list"
            ready={ready}
            renderPlace={(key) => <button>{key}</button>}
          />
        </ViewScrollContext>
      </Provider>
    </StrictMode>
  );
  const view = render(draw(false), { container: host });
  expect(host.scrollTop).toBe(0);
  view.rerender(draw(true));
  expect(host.scrollTop).toBe(456);
  view.unmount();
  host.remove();
});
