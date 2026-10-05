import { createContext, type RefObject } from 'react';
import type { ViewMode } from 'src/stores/ui-store';

export const ViewScrollContext = createContext<{
  ref: RefObject<HTMLDivElement | null>;
  element: HTMLDivElement | null;
  view: ViewMode;
} | null>(null);
