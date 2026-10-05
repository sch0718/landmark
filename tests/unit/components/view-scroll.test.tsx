import { createStore, Provider } from 'jotai';
import { fireEvent, render, within } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { useViewScroll } from 'src/sections/views/use-view-scroll';
import { viewScrollAtom } from 'src/sections/views/store/view-session';
import type { ViewMode } from 'src/stores/ui-store';

function ScrollHost({ view, restore = true }: { view: ViewMode; restore?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useViewScroll(ref, view, restore);
  return <div data-testid="scroll-host" ref={ref} key={view} />;
}

function Harness({ view }: { view: ViewMode }) {
  return <ScrollHost key={view} view={view} />;
}

describe('useViewScroll', () => {
  it('기본 restore는 기존 양수 host를 캐시 0으로 초기화한다', () => {
    const store = createStore();
    function ExistingHost() {
      const ref = useRef<HTMLDivElement>(null);
      useViewScroll(ref, 'day');
      return (
        <div
          data-testid="existing-host"
          ref={(element) => {
            ref.current = element;
            if (element) element.scrollTop = 120;
          }}
        />
      );
    }
    const host = render(
      <Provider store={store}>
        <ExistingHost />
      </Provider>,
    );
    expect(host.getByTestId('existing-host').scrollTop).toBe(0);
  });

  it('restore=false는 복원을 건너뛰고 scroll과 cleanup 위치는 계속 기록한다', () => {
    const store = createStore();
    store.set(viewScrollAtom, { map: 180, day: 40, places: 500 });
    const host = render(
      <Provider store={store}>
        <ScrollHost view="places" restore={false} />
      </Provider>,
    );
    const element = host.getByTestId('scroll-host');
    expect(element.scrollTop).toBe(0);

    element.scrollTop = 70;
    fireEvent.scroll(element);
    expect(store.get(viewScrollAtom)).toEqual({ map: 180, day: 40, places: 70 });
    element.scrollTop = 95;
    host.unmount();
    expect(store.get(viewScrollAtom)).toEqual({ map: 180, day: 40, places: 95 });
    element.scrollTop = 130;
    fireEvent.scroll(element);
    expect(store.get(viewScrollAtom).places).toBe(95);
  });

  it('key가 바뀐 scroll host에서 뷰별 위치를 복원하고 Provider 간 상태를 분리한다', () => {
    const store = createStore();
    const otherStore = createStore();
    const first = render(
      <Provider store={store}>
        <Harness view="map" />
      </Provider>,
    );
    const mapHost = first.getByTestId('scroll-host');
    Object.defineProperty(mapHost, 'scrollTop', { value: 180, writable: true });
    fireEvent.scroll(mapHost);

    first.rerender(
      <Provider store={store}>
        <Harness view="places" />
      </Provider>,
    );
    const placesHost = first.getByTestId('scroll-host');
    Object.defineProperty(placesHost, 'scrollTop', { value: 70, writable: true });
    fireEvent.scroll(placesHost);
    first.rerender(
      <Provider store={store}>
        <Harness view="map" />
      </Provider>,
    );

    expect(first.getByTestId('scroll-host').scrollTop).toBe(180);
    const other = render(
      <Provider store={otherStore}>
        <Harness view="map" />
      </Provider>,
    );
    expect(within(other.container).getByTestId('scroll-host').scrollTop).toBe(0);
  });
});
