import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VirtualPlaceRows } from 'src/sections/explore/view/VirtualPlaceRows';
import {
  placeScrollAckAtom,
  virtualPlaceCacheAtom,
} from 'src/sections/explore/view/virtual-place-state';
import { ViewScrollContext } from 'src/sections/views/view-scroll-context';
import { selectedPlaceScrollRequestAtom } from 'src/sections/views/store/view-session';
import { selectedPlaceAtom } from 'src/stores/ui-store';
let originalScroll: PropertyDescriptor | undefined;
const scroll = vi.fn();
beforeEach(() => {
  originalScroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  scroll.mockReset();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: scroll,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalScroll) Object.defineProperty(Element.prototype, 'scrollIntoView', originalScroll);
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});
it('데이터 준비 전 요청을 보존하고 준비된 행 측정 뒤 ack한다', async () => {
  const store = createStore(),
    content = {};
  store.set(selectedPlaceAtom, 'last');
  store.set(selectedPlaceScrollRequestAtom, 1);
  const draw = (ready: boolean) => (
    <Provider store={store}>
      <VirtualPlaceRows
        keys={ready ? ['first', 'last'] : []}
        variant="list"
        content={content}
        ready={ready}
        renderPlace={(key) => <button>{key}</button>}
      />
    </Provider>
  );
  const view = render(draw(false));
  expect(store.get(placeScrollAckAtom)).toBe(0);
  view.rerender(draw(true));
  await waitFor(() => expect(store.get(placeScrollAckAtom)).toBe(1));
  expect(screen.getByRole('button', { name: 'last' })).toBeInTheDocument();
  act(() => store.set(selectedPlaceScrollRequestAtom, 2));
  await waitFor(() => expect(store.get(placeScrollAckAtom)).toBe(2));
  expect(scroll).toHaveBeenCalledTimes(2);
});
it('진행 중 요청이 filter/delete로 사라지면 예약 frame을 취소하고 다음 요청을 처리한다', async () => {
  const callbacks = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callbacks.set(++next, callback);
    return next;
  });
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    callbacks.delete(id);
  });
  const store = createStore(),
    content = {};
  store.set(selectedPlaceAtom, 'last');
  store.set(selectedPlaceScrollRequestAtom, 1);
  const draw = (keys: string[]) => (
    <Provider store={store}>
      <VirtualPlaceRows
        keys={keys}
        variant="list"
        content={content}
        ready
        renderPlace={(key) => <button>{key}</button>}
      />
    </Provider>
  );
  const view = render(draw(['first', 'last']));
  expect(store.get(placeScrollAckAtom)).toBe(0);
  expect(callbacks.size).toBe(1);
  view.rerender(draw(['first']));
  expect(cancel).toHaveBeenCalled();
  expect(callbacks.size).toBe(0);
  expect(store.get(placeScrollAckAtom)).toBe(1);
  act(() => {
    store.set(selectedPlaceAtom, 'first');
    store.set(selectedPlaceScrollRequestAtom, 2);
  });
  act(() => {
    for (const [id, callback] of [...callbacks]) {
      callbacks.delete(id);
      callback(0);
    }
  });
  await waitFor(() => expect(store.get(placeScrollAckAtom)).toBe(2));
  act(() => {
    store.set(selectedPlaceAtom, 'first');
    store.set(selectedPlaceScrollRequestAtom, 3);
  });
  view.unmount();
  expect(callbacks.size).toBe(0);
  expect(store.get(placeScrollAckAtom)).toBe(2);
});
it('활성 정적 목록 content 갱신은 offset을 유지하고 cache에는 최신 content를 기록한다', () => {
  const store = createStore(),
    first = {},
    second = {},
    host = document.createElement('div');
  document.body.appendChild(host);
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 390 });
  const ref = { current: host };
  const keys = Array.from({ length: 60 }, (_, i) => String(i));
  const draw = (content: object) => (
    <Provider store={store}>
      <ViewScrollContext value={{ ref, element: host, view: 'places' }}>
        <VirtualPlaceRows
          keys={keys}
          variant="list"
          content={content}
          ready
          renderPlace={(key) => <button>{key}</button>}
        />
      </ViewScrollContext>
    </Provider>
  );
  const view = render(draw(first), { container: host });
  host.scrollTop = 420;
  view.rerender(draw(second));
  expect(host.scrollTop).toBe(420);
  view.unmount();
  expect(store.get(virtualPlaceCacheAtom).places?.content).toBe(second);
  expect(store.get(virtualPlaceCacheAtom).places?.offset).toBe(420);
  host.remove();
});
it('준비 완료 후 필터 제외·삭제된 대상은 ack하고 빈 목록을 표시한다', () => {
  const store = createStore();
  store.set(selectedPlaceAtom, 'gone');
  store.set(selectedPlaceScrollRequestAtom, 3);
  render(
    <Provider store={store}>
      <VirtualPlaceRows
        keys={[]}
        variant="list"
        content={{}}
        ready
        renderPlace={(key) => <button>{key}</button>}
      />
    </Provider>,
  );
  expect(store.get(placeScrollAckAtom)).toBe(3);
  expect(screen.queryByRole('button')).toBeNull();
});
it('viewport를 가로지르는 큰 정적 행은 상단을 맞춘 뒤 요청을 완료한다', () => {
  const callbacks = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callbacks.set(++next, callback);
    return next;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    callbacks.delete(id);
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 390 });
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: 100 });
  let rowTop = -20;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this === host ? new DOMRect(0, 0, 390, 100) : new DOMRect(0, rowTop, 390, 200);
  });
  scroll.mockImplementation((options?: ScrollIntoViewOptions) => {
    if (options?.block === 'start') rowTop = 0;
  });
  const store = createStore();
  store.set(selectedPlaceAtom, 'large');
  store.set(selectedPlaceScrollRequestAtom, 1);
  const ref = { current: host };
  const view = render(
    <Provider store={store}>
      <ViewScrollContext value={{ ref, element: host, view: 'map' }}>
        <VirtualPlaceRows
          keys={['large']}
          variant="list"
          content={{}}
          ready
          renderPlace={(key) => <button>{key}</button>}
        />
      </ViewScrollContext>
    </Provider>,
    { container: host },
  );
  try {
    expect(store.get(placeScrollAckAtom)).toBe(0);
    act(() => {
      for (let frame = 0; frame < 3; frame++) {
        for (const [id, callback] of [...callbacks]) {
          callbacks.delete(id);
          callback(0);
        }
      }
    });
    expect(store.get(placeScrollAckAtom)).toBe(1);
    expect(rowTop).toBe(0);
    expect(scroll).toHaveBeenCalledWith({ block: 'start' });
    expect(callbacks.size).toBe(0);
  } finally {
    view.unmount();
    host.remove();
  }
});

it.each([
  ['grid', false, 2, 1],
  ['list', false, 1, 1],
  ['list', true, 1, 1],
  ['grid', true, 4, 2],
] as const)(
  '%s desktop=%s에서 고정 열과 auto-fit 탐색 계약을 유지한다',
  (variant, desktop, probes, observers) => {
    const observer = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal('ResizeObserver', observer);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: desktop, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 390, 844),
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = render(
      <Provider store={createStore()}>
        <ViewScrollContext value={{ ref: { current: host }, element: host, view: 'places' }}>
          <VirtualPlaceRows
            keys={Array.from({ length: 500 }, (_, i) => String(i))}
            variant={variant}
            content={{}}
            ready
            renderPlace={(key) => <button>{key}</button>}
          />
        </ViewScrollContext>
      </Provider>,
      { container: host },
    );
    try {
      expect(host.querySelector('[aria-hidden]')!.children).toHaveLength(probes);
      expect(
        observer.mock.results.filter(({ value }) =>
          value.observe.mock.calls.some(
            ([node]: [Element]) => node === host.querySelector('[aria-hidden]'),
          ),
        ),
      ).toHaveLength(observers);
    } finally {
      view.unmount();
      host.remove();
      vi.unstubAllGlobals();
    }
  },
);
