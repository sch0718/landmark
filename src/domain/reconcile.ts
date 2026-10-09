import { groupDates, placementOfEffective, placementOfTrip } from 'src/domain/date-groups';
import { hashDayStops, sameDayStops } from 'src/domain/day-hash';
import { findDuplicateStopIds, overlay } from 'src/domain/overlay';
import {
  EDIT_LAYER_PARSE,
  EditLayerSchema,
  type DayEdit,
  type EditLayer,
} from 'src/schema/legacy/edit-layer';
import { safeParse } from 'src/schema/parse';
import type { TripData } from 'src/schema/legacy/trip-data';

export type ReconcileReport = {
  removedStops: { date: string; stopId: string; placeKey: string }[];
  orphanPlaceKeys: string[];
  hiddenEditDates: string[];
  autoResetDates: string[];
  unresolvedGroups: string[][];
};

/**
 * 로컬 편집을 (더 새로울 수 있는) 원본에 맞춰 정리한다(§5.5). 입력은 변경하지 않는다.
 * 기계적 정리이므로 stops 제거·자동 reset에서 `updatedAt`과 `baseDayHash`는 건드리지 않는다.
 */
export function reconcile(
  trip: TripData,
  edit: EditLayer,
): { edit: EditLayer; report: ReconcileReport } {
  const tripDays = new Map(trip.days.map((d) => [d.date, d]));
  const removedStops: ReconcileReport['removedStops'] = [];
  const autoResetDates: string[] = [];
  const days: Record<string, DayEdit> = {};

  for (const [date, dayEdit] of Object.entries(edit.days)) {
    if (dayEdit.mode !== 'override') {
      days[date] = dayEdit;
      continue;
    }
    const kept = dayEdit.stops.filter((s) => {
      if (s.placeKey in trip.places) return true;
      removedStops.push({ date, stopId: s.id, placeKey: s.placeKey });
      return false;
    });
    const original = tripDays.get(date);
    // 자동 reset은 로컬 편집을 버리므로 해시가 아니라 내용으로 판정한다(해시 충돌 시 데이터 손실).
    if (original && sameDayStops(kept, original.stops)) {
      days[date] = { mode: 'reset', updatedAt: dayEdit.updatedAt };
      autoResetDates.push(date);
    } else {
      days[date] = kept.length === dayEdit.stops.length ? dayEdit : { ...dayEdit, stops: kept };
    }
  }

  const result: EditLayer = { ...edit, days, baseDataVersion: trip.dataVersion };
  const eff = overlay(trip, result);

  const unresolved = new Set<string>();
  for (const [date, dayEdit] of Object.entries(days)) {
    const original = tripDays.get(date);
    if (
      dayEdit.mode === 'override' &&
      original &&
      dayEdit.baseDayHash !== hashDayStops(original.stops)
    ) {
      unresolved.add(date);
    }
  }
  const unresolvedGroups = groupDates(
    [placementOfTrip(trip), placementOfEffective(eff)],
    trip.days.map((d) => d.date),
  ).filter((group) => group.some((date) => unresolved.has(date)));

  return {
    edit: result,
    report: {
      removedStops,
      orphanPlaceKeys: Object.keys(result.places)
        .filter((key) => !(key in trip.places))
        .sort(),
      hiddenEditDates: eff.hiddenEditDates,
      autoResetDates,
      unresolvedGroups,
    },
  };
}

/**
 * `[내 편집 유지]`(§5.5): 묶음 안의 방문 배치를 local 쪽으로 확정한다.
 * 검증(stop.id 전체 유일, 스키마)에 실패하면 null.
 */
export function keepMine(
  trip: TripData,
  edit: EditLayer,
  groupDates: string[],
  now: string,
): EditLayer | null {
  const tripDays = new Map(trip.days.map((d) => [d.date, d]));
  const effective = new Map(overlay(trip, edit).days.map((d) => [d.date, d]));
  const days: Record<string, DayEdit> = { ...edit.days };

  for (const date of groupDates) {
    const original = tripDays.get(date);
    const eff = effective.get(date);
    if (!original || !eff) continue;
    if (days[date]?.mode !== 'override' && eff.removedByPlacement.length > 0) {
      days[date] = {
        mode: 'override',
        stops: eff.stops.map((s) => ({ ...s })),
        baseDayHash: hashDayStops(original.stops),
        updatedAt: now,
      };
    }
  }
  for (const date of groupDates) {
    const original = tripDays.get(date);
    const current = days[date];
    if (original && current?.mode === 'override') {
      days[date] = { ...current, baseDayHash: hashDayStops(original.stops), updatedAt: now };
    }
  }

  const result: EditLayer = { ...edit, days };
  if (findDuplicateStopIds(overlay(trip, result).days).length > 0) return null;
  if (!safeParse(EditLayerSchema, result, EDIT_LAYER_PARSE).success) return null;
  return result;
}
