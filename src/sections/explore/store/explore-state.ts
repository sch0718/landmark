import { atom, useAtomValue } from 'jotai';
import { useMemo } from 'react';
import type { Bounds, MapMarker } from 'src/components/map/MapAdapter';
import { categoryColor } from 'src/components/map/map-colors';
import { useTripStore } from 'src/stores/trip-store';
import { modeAtom, searchQueryAtom, selectedPlaceAtom } from 'src/stores/ui-store';
import { DEFAULT_FILTER, filterPlaces, type ExploreFilter } from './filters';

/** 탐색 필터(검색어는 상단 바의 `searchQueryAtom`을 쓴다). */
export const exploreFilterAtom = atom<ExploreFilter>(DEFAULT_FILTER);
/** 지도가 알려 준 현재 화면 영역. */
export const mapBoundsAtom = atom<Bounds | null>(null);
/** 목록에서 장소를 눌렀을 때 지도를 옮기라는 요청. `seq`로 같은 장소 재요청도 구분한다. */
export type MapFocus = { point: [number, number]; seq: number };
export const mapFocusAtom = atom<MapFocus | null>(null);

/** 필터를 통과한 placeKey 목록. */
export function useExploreKeys(): string[] {
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const edit = useAtomValue(ts.editLayerAtom);
  const eff = useAtomValue(ts.effectiveTripAtom);
  const filter = useAtomValue(exploreFilterAtom);
  const query = useAtomValue(searchQueryAtom);
  const bounds = useAtomValue(mapBoundsAtom);
  return useMemo(() => {
    if (!trip || !eff) return [];
    return filterPlaces(trip, edit, eff, { ...filter, query }, bounds ?? undefined);
  }, [trip, edit, eff, filter, query, bounds]);
}

const NO_MARKERS: MapMarker[] = [];

/** 탐색 모드의 지도 마커. 다른 모드에서는 빈 목록. */
export function useExploreMarkers(): MapMarker[] {
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const mode = useAtomValue(modeAtom);
  const selected = useAtomValue(selectedPlaceAtom);
  const keys = useExploreKeys();
  return useMemo(() => {
    if (mode !== 'explore' || !trip) return NO_MARKERS;
    return keys.flatMap((key): MapMarker[] => {
      const p = trip.places[key];
      if (!p) return [];
      return [
        {
          id: key,
          lng: p.lng,
          lat: p.lat,
          label: p.name,
          color: categoryColor(p.category),
          clusterable: true,
          selected: key === selected,
        },
      ];
    });
  }, [mode, trip, keys, selected]);
}
