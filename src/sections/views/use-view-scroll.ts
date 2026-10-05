import { useStore } from 'jotai';
import { useLayoutEffect, type RefObject } from 'react';
import type { ViewMode } from 'src/stores/ui-store';
import { viewScrollAtom } from './store/view-session';

export function useViewScroll(
  ref: RefObject<HTMLElement | null>,
  view: ViewMode,
  restore = true,
): void {
  const store = useStore();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (restore) element.scrollTop = store.get(viewScrollAtom)[view];
    const remember = () =>
      store.set(viewScrollAtom, (positions) => ({ ...positions, [view]: element.scrollTop }));
    element.addEventListener('scroll', remember, { passive: true });
    return () => {
      remember();
      element.removeEventListener('scroll', remember);
    };
  }, [ref, store, view, restore]);
}
