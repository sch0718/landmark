import { useMemo, useSyncExternalStore, type RefObject } from 'react';
import type { MapAdapter } from './MapAdapter';

const serverSnapshot = () => false;

export function useMapSize(
  hostRef: RefObject<HTMLElement | null>,
  adapter: MapAdapter | null,
  visible: boolean,
): boolean {
  const source = useMemo(
    () => createSizeSource(hostRef, adapter, visible),
    [hostRef, adapter, visible],
  );
  return useSyncExternalStore(source.subscribe, source.snapshot, serverSnapshot);
}

function createSizeSource(
  hostRef: RefObject<HTMLElement | null>,
  adapter: MapAdapter | null,
  visible: boolean,
) {
  let positive = false;
  return {
    snapshot: () => positive,
    subscribe(notify: () => void) {
      const host = hostRef.current;
      if (!host || !adapter || !visible) return () => {};
      let frame = 0;
      let previous = '';
      const measure = () => {
        frame = 0;
        const rect = host.getBoundingClientRect();
        const width = Math.round(rect.width),
          height = Math.round(rect.height);
        const next = width > 0 && height > 0;
        if (next && `${width}:${height}` !== previous) {
          previous = `${width}:${height}`;
          adapter.resize(width, height);
        }
        if (!next) previous = '';
        if (positive !== next) {
          positive = next;
          notify();
        }
      };
      const schedule = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(measure);
      };
      const observer = new ResizeObserver(schedule);
      observer.observe(host);
      schedule();
      return () => {
        observer.disconnect();
        cancelAnimationFrame(frame);
        positive = false;
      };
    },
  };
}
