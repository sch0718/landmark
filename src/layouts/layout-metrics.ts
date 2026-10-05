import useMediaQuery from '@mui/material/useMediaQuery';
import { useState, useSyncExternalStore } from 'react';
export type LayoutKind = 'compact' | 'split' | 'wide';
export const SPLIT_QUERY = '(min-width: 768px)';
export const WIDE_QUERY = '(min-width: 1440px)';
export function useLayoutKind(): LayoutKind {
  const split = useMediaQuery(SPLIT_QUERY);
  const wide = useMediaQuery(WIDE_QUERY);
  return wide ? 'wide' : split ? 'split' : 'compact';
}
export type SheetSnap = 'peek' | 'half' | 'full';
export function sheetHeight(snap: SheetSnap, available: number): number {
  const max = Math.max(0, available - 48);
  const desired =
    snap === 'peek' ? 164 : snap === 'half' ? Math.max(288, available * 0.48) : available * 0.88;
  return Math.round(Math.min(max, Math.max(0, desired)));
}

function createViewportSource() {
  const measure = () =>
    typeof window === 'undefined'
      ? 800
      : Math.round(window.visualViewport?.height ?? window.innerHeight);
  let height = measure();
  return {
    snapshot: () => height,
    subscribe(notify: () => void) {
      const viewport = window.visualViewport;
      const update = () => {
        const next = measure();
        if (next !== height) {
          height = next;
          notify();
        }
      };
      window.addEventListener('resize', update);
      viewport?.addEventListener('resize', update);
      update();
      return () => {
        window.removeEventListener('resize', update);
        viewport?.removeEventListener('resize', update);
      };
    },
  };
}
export function useViewportHeight(): number {
  const [source] = useState(createViewportSource);
  return useSyncExternalStore(source.subscribe, source.snapshot, () => 800);
}
