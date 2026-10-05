import { atom } from 'jotai';
import type { VirtualItem } from '@tanstack/react-virtual';
import type { ViewMode } from 'src/stores/ui-store';

export type PlaceVariant = 'grid' | 'list';
export type PlaceAnchor = { index: number; delta: number };
export type PlaceCache = {
  key: string;
  content: object;
  offset: number;
  measurements: VirtualItem[];
  anchor?: PlaceAnchor;
};

export const virtualPlaceCacheAtom = atom<Partial<Record<ViewMode, PlaceCache>>>({});
export const placeScrollAckAtom = atom(0);

export function columnsFromTemplate(template: string): number {
  return Math.max(1, template.split(' ').filter((part) => Number.parseFloat(part) > 0).length);
}

export function rowsOf(keys: readonly string[], columns: number): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < keys.length; i += Math.max(1, columns)) {
    rows.push(keys.slice(i, i + Math.max(1, columns)));
  }
  return rows;
}

export function cacheKey(
  variant: PlaceVariant,
  width: number,
  columns: number,
  keys: readonly string[],
): string {
  return JSON.stringify([variant, width, columns, keys]);
}
