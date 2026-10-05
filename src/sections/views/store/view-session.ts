import { atom } from 'jotai';
import type { ViewMode } from 'src/stores/ui-store';

export type DetailState =
  | { kind: 'place'; placeKey: string }
  | { kind: 'add'; placeKey: string }
  | { kind: 'filter' }
  | { kind: 'stop'; date: string; stopId: string };

export type StopDraft = { date: string; time: string; note: string };

export const detailAtom = atom<DetailState | null>(null);
export const memoDraftsAtom = atom<Record<string, string>>({});
export const tagDraftsAtom = atom<Record<string, string>>({});
export const mapSheetSnapAtom = atom<'peek' | 'half' | 'full'>('peek');
export const stopDraftsAtom = atom<Record<string, StopDraft>>({});
export const itineraryEditingAtom = atom(false);
export const mobileRouteMapAtom = atom(false);
export const placeDisplayAtom = atom<'grid' | 'list'>('grid');
export const viewScrollAtom = atom<Record<ViewMode, number>>({ map: 0, day: 0, places: 0 });
export const selectedPlaceScrollRequestAtom = atom(0);
export const searchFocusRequestedAtom = atom(false);
