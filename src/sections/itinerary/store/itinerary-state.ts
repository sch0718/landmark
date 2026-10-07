import { atom, useAtomValue } from 'jotai';
import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import type { MapMarker, MapPolyline } from 'src/components/map/MapAdapter';
import { categoryColor, dayColor } from 'src/components/map/map-colors';
import { buildLegIndex, effectiveLegs, type DisplayLeg } from 'src/domain/leg-index';
import { overlay, type EffectiveDay } from 'src/domain/overlay';
import { effectiveCategory } from 'src/domain/place-category';
import { LIMITS } from 'src/schema/common';
import type { EditLayer } from 'src/schema/edit-layer';
import type { TripData } from 'src/schema/trip-data';
import { addStopToDay } from 'src/sections/explore/store/add-stop';
import { useEditActions, useTripStore } from 'src/stores/trip-store';
import { modeAtom, selectedDayAtom } from 'src/stores/ui-store';
import { circled } from './format';

/** 후보 레이어(일정에 없는 저장 장소를 흐린 마커로) 표시 여부. */
export const candidateLayerAtom = atom(false);

export const CANDIDATE_PREFIX = 'candidate/';

export function reportSaveError(e: unknown) {
  console.warn('편집을 저장하지 못했어요', e);
  toast.error('편집을 저장하지 못했어요');
}

/** 실효 일정의 하루와 표시용 구간. */
export type ItineraryDay = { day: EffectiveDay; index: number; legs: DisplayLeg[] };

/** 실효 일정의 모든 날과 그 구간(trip.days 순서). */
export function useItineraryDays(): ItineraryDay[] {
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const eff = useAtomValue(ts.effectiveTripAtom);
  const index = useMemo(() => (trip ? buildLegIndex(trip) : null), [trip]);
  return useMemo(() => {
    if (!trip || !eff || !index) return [];
    return eff.days.map((day, i) => ({ day, index: i, legs: effectiveLegs(day, trip, index) }));
  }, [trip, eff, index]);
}

/** 편집 저장: `now`를 한 번 정해 `update(e => fn(trip, e, now))`로 감싼다. */
export function useItinerarySave() {
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const { update } = useEditActions();
  return useCallback(
    (fn: (trip: TripData, edit: EditLayer, now: string) => EditLayer) => {
      if (!trip) return;
      const now = ts.nowIso();
      update((e) => fn(trip, e, now)).catch(reportSaveError);
    },
    [trip, ts, update],
  );
}

/** 하루 stops의 마커. 같은 placeKey의 순번(1부터)을 원문자로 이어 붙인다(`①⑥`). */
function dayMarkers(
  trip: TripData,
  day: EffectiveDay,
  color: string,
  idOf: (placeKey: string) => string,
): MapMarker[] {
  const positions = new Map<string, number[]>();
  day.stops.forEach((s, i) => {
    const list = positions.get(s.placeKey) ?? [];
    list.push(i + 1);
    positions.set(s.placeKey, list);
  });
  return [...positions].flatMap(([placeKey, nums]): MapMarker[] => {
    const p = trip.places[placeKey];
    if (!p) return [];
    return [
      {
        id: idOf(placeKey),
        lng: p.lng,
        lat: p.lat,
        label: nums.map(circled).join(''),
        color,
        clusterable: false,
      },
    ];
  });
}

const dayPolylines = (item: ItineraryDay): MapPolyline[] =>
  item.legs.map((leg, i) => ({
    id: `${item.day.date}/${i}`,
    path: leg.path,
    color: dayColor(item.index),
    dashed: leg.status !== 'routed',
  }));

export type ItineraryLayers = { markers: MapMarker[]; polylines: MapPolyline[] };
const EMPTY: ItineraryLayers = { markers: [], polylines: [] };

/** 일정 모드의 지도 마커·폴리라인. 다른 모드에서는 빈 목록. */
export function useItineraryLayers(): ItineraryLayers {
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const edit = useAtomValue(ts.editLayerAtom);
  const mode = useAtomValue(modeAtom);
  const selected = useAtomValue(selectedDayAtom);
  const showCandidates = useAtomValue(candidateLayerAtom);
  const days = useItineraryDays();
  return useMemo(() => {
    if (mode !== 'itinerary' || !trip) return EMPTY;
    const markers: MapMarker[] = [];
    const polylines: MapPolyline[] = [];
    for (const item of days) {
      if (selected === 'all') {
        const date = item.day.date;
        markers.push(...dayMarkers(trip, item.day, dayColor(item.index), (k) => `${date}/${k}`));
      } else if (item.day.date === selected) {
        markers.push(...dayMarkers(trip, item.day, dayColor(item.index), (k) => k));
      } else {
        continue;
      }
      polylines.push(...dayPolylines(item));
    }
    if (showCandidates) {
      const inItinerary = new Set(days.flatMap((d) => d.day.stops.map((s) => s.placeKey)));
      for (const [key, p] of Object.entries(trip.places)) {
        if (inItinerary.has(key) || edit?.places[key]?.hidden?.value) continue;
        markers.push({
          id: `${CANDIDATE_PREFIX}${key}`,
          lng: p.lng,
          lat: p.lat,
          label: p.name,
          color: categoryColor(effectiveCategory(p, edit?.places[key])),
          dimmed: true,
          clusterable: true,
        });
      }
    }
    return { markers, polylines };
  }, [mode, trip, edit, selected, showCandidates, days]);
}

/** 일정 모드 마커 클릭: 후보 마커면 선택한 날 끝에 추가한다. */
export function useItineraryMarkerClick(): (id: string) => void {
  const selected = useAtomValue(selectedDayAtom);
  const save = useItinerarySave();
  return useCallback(
    (id: string) => {
      if (!id.startsWith(CANDIDATE_PREFIX)) return;
      if (selected === 'all') {
        toast('후보를 넣을 Day 탭을 먼저 고르세요');
        return;
      }
      const placeKey = id.slice(CANDIDATE_PREFIX.length);
      save((trip, e, now) => {
        const count = overlay(trip, e).days.find((d) => d.date === selected)?.stops.length ?? 0;
        if (count >= LIMITS.stopsPerDay) {
          toast.error(`하루에 ${LIMITS.stopsPerDay}곳까지 넣을 수 있어요`);
          return e;
        }
        return addStopToDay(trip, e, selected, placeKey, now);
      });
    },
    [selected, save],
  );
}
