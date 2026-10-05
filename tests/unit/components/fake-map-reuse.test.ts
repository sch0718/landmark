import { expect, it, vi } from 'vitest';
import { FakeMapAdapter } from 'src/components/map/FakeMapAdapter';
import type { MapMarker } from 'src/components/map/MapAdapter';

it('500개 marker와 click을 보존하고 독립 layer 갱신에서 DOM을 재사용한다', async () => {
  const host = document.createElement('div');
  const adapter = new FakeMapAdapter();
  const markers: MapMarker[] = Array.from({ length: 500 }, (_, i) => ({
    id: String(i),
    lng: 128,
    lat: 37,
    label: `장소${i}`,
    color: '#123456',
    clusterable: true,
  }));

  await adapter.mount(host);
  adapter.setMarkers(markers);
  const buttons = [...host.querySelectorAll('button')];
  const labels = buttons.map((button) => button.firstElementChild);
  expect(buttons).toHaveLength(500);

  adapter.setPolylines([
    {
      id: 'route',
      path: [
        [128, 37],
        [129, 38],
      ],
      color: '#123456',
      dashed: true,
    },
  ]);
  expect([...host.querySelectorAll('button')]).toEqual(buttons);
  buttons.forEach((button, index) => {
    expect(host.querySelector(`[data-testid="marker-${index}"]`)).toBe(button);
  });

  adapter.setMarkers(markers.map((marker) => ({ ...marker })));
  const sameInputButtons = [...host.querySelectorAll('button')];
  expect(sameInputButtons).toHaveLength(buttons.length);
  sameInputButtons.forEach((button, index) => {
    expect(button).toBe(buttons[index]);
    expect(button.firstElementChild).toBe(labels[index]);
  });

  const click = vi.fn();
  adapter.onMarkerClick(click);
  buttons[499]!.click();
  expect(click).toHaveBeenCalledWith('499');

  const changedMarkers = markers.map((marker) => ({
    ...marker,
    ...(marker.id === '499' ? { selected: true, label: '변경', dimmed: true } : {}),
  }));
  adapter.setMarkers(changedMarkers);
  expect(buttons[499]).toHaveAttribute('aria-pressed', 'true');
  expect(buttons[499]).toHaveAttribute('data-dimmed', 'true');
  expect(buttons[499]?.textContent).toBe('변경');
  expect(buttons[499]?.firstElementChild).not.toBe(labels[499]);
  buttons.slice(0, 499).forEach((button, index) => {
    expect(host.querySelector(`[data-testid="marker-${index}"]`)).toBe(button);
    expect(button.firstElementChild).toBe(labels[index]);
  });
  expect(host.querySelector('[data-testid="polyline-route"]')).toHaveAttribute('data-points', '2');

  adapter.setMarkers([changedMarkers[1]!, changedMarkers[0]!, ...changedMarkers.slice(2, 499)]);
  expect(host.querySelector('[data-testid="marker-1"]')).toBe(buttons[1]);
  expect(host.querySelector('[data-testid="marker-0"]')).toBe(buttons[0]);
  expect(host.querySelectorAll('button')[0]).toBe(buttons[1]);
  expect(host.querySelectorAll('button')[1]).toBe(buttons[0]);

  adapter.setMarkers(changedMarkers.slice(0, 499));
  buttons[499]!.click();
  expect(click).toHaveBeenCalledTimes(1);
  adapter.destroy();
  buttons[0]!.click();
  expect(click).toHaveBeenCalledTimes(1);
  expect(host.children).toHaveLength(0);
});
