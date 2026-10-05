import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode, useLayoutEffect } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { useViewportHeight } from 'src/layouts/layout-metrics';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Probe({ revision = 0, name = 'height' }: { revision?: number; name?: string }) {
  const height = useViewportHeight();
  return <output aria-label={name}>{`${height}:${revision}`}</output>;
}

function installViewport(initial: number) {
  let height = initial;
  const viewport = new EventTarget();
  const read = vi.fn(() => height);
  Object.defineProperty(viewport, 'height', { get: read });
  vi.stubGlobal('visualViewport', viewport);
  return { viewport, read, setHeight: (next: number) => (height = next) };
}

it('반복 render와 commit은 캐시된 반올림 높이를 사용한다', () => {
  const { read } = installViewport(641.6);
  const fallbackRead = vi.spyOn(window, 'innerHeight', 'get');
  const { rerender } = render(<Probe />);
  expect(screen.getByLabelText('height')).toHaveTextContent('642:0');
  expect(read).toHaveBeenCalled();
  read.mockClear();
  for (let revision = 1; revision <= 5; revision++) rerender(<Probe revision={revision} />);
  expect(screen.getByLabelText('height')).toHaveTextContent('642:5');
  expect(read).not.toHaveBeenCalled();
  expect(fallbackRead).not.toHaveBeenCalled();
});

it('두 resize source는 동기 측정하고 높이가 그대로이면 다시 render하지 않는다', () => {
  const { viewport, read, setHeight } = installViewport(700);
  const renders = vi.fn();
  function Consumer() {
    renders();
    return <output aria-label="height">{useViewportHeight()}</output>;
  }
  render(<Consumer />);
  read.mockClear();
  renders.mockClear();
  act(() => viewport.dispatchEvent(new Event('resize')));
  expect(read).toHaveBeenCalledTimes(1);
  expect(renders).not.toHaveBeenCalled();
  act(() => {
    setHeight(420.7);
    viewport.dispatchEvent(new Event('resize'));
  });
  expect(screen.getByLabelText('height')).toHaveTextContent('421');
  expect(read).toHaveBeenCalledTimes(2);
  act(() => {
    setHeight(600.2);
    window.dispatchEvent(new Event('resize'));
  });
  expect(screen.getByLabelText('height')).toHaveTextContent('600');
  expect(read).toHaveBeenCalledTimes(3);
});

it('VisualViewport가 없으면 innerHeight를 캐시하고 window resize에 갱신한다', () => {
  vi.stubGlobal('visualViewport', undefined);
  let height = 800.6;
  const read = vi.spyOn(window, 'innerHeight', 'get').mockImplementation(() => height);
  const { rerender } = render(<Probe />);
  expect(screen.getByLabelText('height')).toHaveTextContent('801:0');
  read.mockClear();
  rerender(<Probe revision={1} />);
  expect(read).not.toHaveBeenCalled();
  act(() => {
    height = 500.4;
    window.dispatchEvent(new Event('resize'));
  });
  expect(screen.getByLabelText('height')).toHaveTextContent('500:1');
  expect(read).toHaveBeenCalledTimes(1);
});

it('첫 render와 구독 사이 resize의 최신 높이를 반영한다', () => {
  const { viewport, setHeight } = installViewport(700);
  function ResizeBeforeSubscription() {
    useLayoutEffect(() => {
      setHeight(450);
      viewport.dispatchEvent(new Event('resize'));
    }, []);
    return null;
  }
  render(
    <>
      <Probe />
      <ResizeBeforeSubscription />
    </>,
  );
  expect(screen.getByLabelText('height')).toHaveTextContent('450:0');
});

it('StrictMode 재구독 뒤 캐시를 유지하고 모든 resize listener를 정리한다', () => {
  const { viewport, read, setHeight } = installViewport(700);
  const addWindow = vi.spyOn(window, 'addEventListener');
  const removeWindow = vi.spyOn(window, 'removeEventListener');
  const addViewport = vi.spyOn(viewport, 'addEventListener');
  const removeViewport = vi.spyOn(viewport, 'removeEventListener');
  let layouts = 0;
  function ResizeDuringResubscription() {
    useLayoutEffect(() => {
      if (++layouts === 2) {
        setHeight(430);
        viewport.dispatchEvent(new Event('resize'));
      }
    }, []);
    return null;
  }
  const content = (revision: number) => (
    <StrictMode>
      <Probe revision={revision} />
      <ResizeDuringResubscription />
    </StrictMode>
  );
  const { rerender, unmount } = render(content(0));
  expect(screen.getByLabelText('height')).toHaveTextContent('430:0');
  read.mockClear();
  rerender(content(1));
  expect(read).not.toHaveBeenCalled();
  act(() => {
    setHeight(410);
    viewport.dispatchEvent(new Event('resize'));
  });
  expect(screen.getByLabelText('height')).toHaveTextContent('410:1');
  expect(read).toHaveBeenCalledTimes(1);
  unmount();
  for (const [add, remove] of [
    [addWindow, removeWindow],
    [addViewport, removeViewport],
  ]) {
    const added = add!.mock.calls.filter(([event]) => event === 'resize');
    const removed = remove!.mock.calls.filter(([event]) => event === 'resize');
    expect(added.length).toBeGreaterThanOrEqual(2);
    expect(removed).toEqual(added);
  }
  read.mockClear();
  act(() => {
    window.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('resize'));
  });
  expect(read).not.toHaveBeenCalled();
});

it('consumer 해제는 다른 consumer를 유지하며 모두 해제한 뒤 최신 viewport로 mount한다', () => {
  const first = installViewport(700);
  const a = render(<Probe name="a" />);
  const b = render(<Probe name="b" />);
  a.unmount();
  act(() => {
    first.setHeight(500);
    first.viewport.dispatchEvent(new Event('resize'));
  });
  expect(screen.getByLabelText('b')).toHaveTextContent('500:0');
  b.unmount();
  first.read.mockClear();
  const next = installViewport(900.7);
  render(<Probe />);
  expect(screen.getByLabelText('height')).toHaveTextContent('901:0');
  expect(first.read).not.toHaveBeenCalled();
  expect(next.read).toHaveBeenCalled();
});

it('구독자가 없는 동안 바뀐 같은 viewport의 높이를 다시 mount할 때 읽는다', () => {
  const { viewport, setHeight } = installViewport(700);
  const { unmount } = render(<Probe />);
  unmount();
  setHeight(350);
  viewport.dispatchEvent(new Event('resize'));
  render(<Probe />);
  expect(screen.getByLabelText('height')).toHaveTextContent('350:0');
});

it('server snapshot은 800을 유지한다', () => {
  installViewport(420);
  expect(renderToString(<Probe />)).toContain('800:0');
});
