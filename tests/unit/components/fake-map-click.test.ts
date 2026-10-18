import { describe, expect, it, vi } from 'vitest';
import { FakeMapAdapter } from 'src/components/map/FakeMapAdapter';

describe('FakeMapAdapter 지도 누르기', () => {
  it('마커가 아닌 곳을 누르면 onMapClick, 마커를 누르면 onMarkerClick만', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const adapter = new FakeMapAdapter();
    const onMap = vi.fn();
    const onMarker = vi.fn();
    adapter.onMapClick(onMap);
    adapter.onMarkerClick(onMarker);
    await adapter.mount(host);
    adapter.setMarkers([
      { id: 'p1', lng: 128, lat: 37, color: '#000', clusterable: false, label: '가' },
    ]);

    const marker = host.querySelector<HTMLElement>('[data-testid="marker-p1"]')!;
    (marker.firstElementChild as HTMLElement).click();
    expect(onMarker).toHaveBeenCalledWith('p1');
    expect(onMap).not.toHaveBeenCalled();

    host.querySelector<HTMLElement>('[data-testid="fake-map"]')!.click();
    expect(onMap).toHaveBeenCalledTimes(1);

    adapter.destroy();
    host.remove();
  });
});
