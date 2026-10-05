import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeMapAdapter } from 'src/components/map/FakeMapAdapter';
import { useMapSize } from 'src/components/map/use-map-size';
import { installMapResources } from './helpers/map-resources';

let resources: ReturnType<typeof installMapResources>;
beforeEach(() => {
  resources = installMapResources(0, 0);
});
afterEach(() => {
  cleanup();
  resources.restore();
  vi.restoreAllMocks();
});
function Host({ adapter, visible = true }: { adapter: FakeMapAdapter | null; visible?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const ready = useMapSize(ref, adapter, visible);
  return <div ref={ref} data-testid="map-host" data-ready={String(ready)} />;
}
describe('useMapSize', () => {
  it('양수 크기를 받은 mounted adapter만 준비되며 중복 크기는 무시한다', async () => {
    const adapter = new FakeMapAdapter();
    const resize = vi.spyOn(adapter, 'resize');
    const { rerender } = render(<Host adapter={null} />);
    const host = screen.getByTestId('map-host');
    expect(host).toHaveAttribute('data-ready', 'false');
    expect(resources.snapshot().observers).toBe(0);
    await adapter.mount(host);
    rerender(<Host adapter={adapter} />);
    await waitFor(() => expect(resources.snapshot().pendingFrames).toBe(0));
    expect(resize).not.toHaveBeenCalled();
    act(() => resources.setSize(host, 390, 500));
    await waitFor(() => expect(host).toHaveAttribute('data-ready', 'true'));
    expect(resize).toHaveBeenCalledExactlyOnceWith(390, 500);
    act(() => resources.setSize(host, 390, 500));
    await waitFor(() => expect(resources.snapshot().pendingFrames).toBe(0));
    expect(resize).toHaveBeenCalledTimes(1);
    act(() => resources.setSize(host, 0, 500));
    await waitFor(() => expect(host).toHaveAttribute('data-ready', 'false'));
    expect(resize).toHaveBeenCalledTimes(1);
    act(() => resources.setSize(host, 390, 500));
    await waitFor(() => expect(host).toHaveAttribute('data-ready', 'true'));
    expect(resize).toHaveBeenCalledTimes(2);
    adapter.destroy();
  });
  it('숨김은 observer와 예약 프레임을 정리하고 재표시 때 재측정한다', async () => {
    const adapter = new FakeMapAdapter();
    const resize = vi.spyOn(adapter, 'resize');
    const { rerender, unmount } = render(<Host adapter={adapter} visible={false} />);
    const host = screen.getByTestId('map-host');
    await adapter.mount(host);
    act(() => resources.setSize(host, 390, 500));
    expect(resize).not.toHaveBeenCalled();
    rerender(<Host adapter={adapter} />);
    await waitFor(() => expect(host).toHaveAttribute('data-ready', 'true'));
    act(() => resources.setSize(host, 600, 700));
    rerender(<Host adapter={adapter} visible={false} />);
    expect(host).toHaveAttribute('data-ready', 'false');
    expect(resources.snapshot().pendingFrames).toBe(0);
    expect(resources.snapshot().observers).toBe(0);
    rerender(<Host adapter={adapter} />);
    await waitFor(() => expect(resize).toHaveBeenLastCalledWith(600, 700));
    unmount();
    adapter.destroy();
    expect(Object.values(resources.snapshot()).every((count) => count === 0)).toBe(true);
  });
  it('지도 host의 own 크기 mock은 기존 prototype geometry spy를 바꾸지 않고 복구된다', async () => {
    const geometry = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 300,
      bottom: 50,
      width: 300,
      height: 50,
      toJSON: () => ({}),
    });
    const adapter = new FakeMapAdapter();
    const { rerender, unmount } = render(<Host adapter={null} />);
    const host = screen.getByTestId('map-host');
    await adapter.mount(host);
    resources.setSize(host, 390, 500);
    rerender(<Host adapter={adapter} />);
    await waitFor(() => expect(host).toHaveAttribute('data-ready', 'true'));
    expect(document.createElement('div').getBoundingClientRect().width).toBe(300);
    expect(host.getBoundingClientRect().width).toBe(390);
    unmount();
    adapter.destroy();
    resources.restore();
    expect(Object.getOwnPropertyDescriptor(host, 'getBoundingClientRect')).toBeUndefined();
    geometry.mockRestore();
  });
});
