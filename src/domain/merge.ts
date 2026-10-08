import { groupDates, placementOfEffective, placementOfTrip } from 'src/domain/date-groups';
import { pickLww } from 'src/domain/lww';
import { findDuplicateStopIds, overlay } from 'src/domain/overlay';
import {
  EDIT_LAYER_PARSE,
  EditLayerSchema,
  isEditLayerTooLarge,
  MERGE_RESULT_TOO_LARGE,
} from 'src/schema/edit-layer';
import type { DayEdit, EditLayer, PlaceEdit } from 'src/schema/edit-layer';
import { safeParse } from 'src/schema/parse';
import type { TripData } from 'src/schema/trip-data';

export type MergeSide = 'local' | 'incoming';

export type DayConflict = {
  /** 묶음 첫 날짜. 선택(`choices`)의 키. */
  id: string;
  dates: string[];
  defaultSide: MergeSide;
  /** 날짜별로는 충돌이 없지만 합치면 stop id가 중복되어 충돌로 승격된 묶음. */
  promoted: boolean;
};

export type MergeSummary = {
  memosAdded: number;
  memosChanged: number;
  memosDeleted: number;
  tagChanges: { placeKey: string; from: string[] | undefined; to: string[] }[];
  hiddenChanges: { placeKey: string; from: boolean | undefined; to: boolean }[];
  /** from: null은 원본 분류, undefined는 local에 분류 편집이 없음. */
  categoryChanges: { placeKey: string; from: string | null | undefined; to: string | null }[];
  /** 충돌 없이 incoming 상태를 채택했고 local과 다른 날짜. */
  daysAdopted: string[];
};

export type MergeResult = { ok: true; edit: EditLayer } | { ok: false; reason: string };

type DayState = DayEdit | undefined;

type GroupPlan =
  | { dates: string[]; conflict: null; adopted: Record<string, DayState> }
  | { dates: string[]; conflict: DayConflict };

const sortedUnion = (...lists: string[][]): string[] => [...new Set(lists.flat())].sort();

/** incoming 값이 LWW로 이기고 local 값과 직렬화가 다르다. */
function incomingWins<T extends { updatedAt: string }>(local: T | undefined, incoming: T): boolean {
  if (local === undefined) return true;
  return (
    pickLww(local, incoming) === incoming && JSON.stringify(local) !== JSON.stringify(incoming)
  );
}

/** 상태 동일성: 둘 다 없음, 또는 같은 mode이고 override면 stops가 같다(baseDayHash·updatedAt 무시). */
function sameDayState(a: DayState, b: DayState): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.mode === 'reset' || b.mode === 'reset') return a.mode === b.mode;
  return (
    a.stops.length === b.stops.length &&
    a.stops.every((s, i) => {
      const t = b.stops[i]!;
      return s.id === t.id && s.placeKey === t.placeKey && s.time === t.time && s.note === t.note;
    })
  );
}

function mergeRecordLww<T extends { updatedAt: string }>(
  local: Record<string, T>,
  incoming: Record<string, T>,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of sortedUnion(Object.keys(local), Object.keys(incoming))) {
    const winner = pickLww(local[key], incoming[key]);
    if (winner !== undefined) out[key] = winner;
  }
  return out;
}

function mergePlaceEdit(local: PlaceEdit | undefined, incoming: PlaceEdit | undefined): PlaceEdit {
  const out: PlaceEdit = { memos: mergeRecordLww(local?.memos ?? {}, incoming?.memos ?? {}) };
  const tags = pickLww(local?.tags, incoming?.tags);
  if (tags !== undefined) out.tags = tags;
  const hidden = pickLww(local?.hidden, incoming?.hidden);
  if (hidden !== undefined) out.hidden = hidden;
  const category = pickLww(local?.category, incoming?.category);
  if (category !== undefined) out.category = category;
  return out;
}

function mergePlaces(
  local: EditLayer['places'],
  incoming: EditLayer['places'],
): EditLayer['places'] {
  const out: EditLayer['places'] = {};
  for (const key of sortedUnion(Object.keys(local), Object.keys(incoming))) {
    out[key] = mergePlaceEdit(local[key], incoming[key]);
  }
  return out;
}

/** 묶음 안 DayEdit 중 LWW 승자를 가진 쪽. 승자가 양쪽에 똑같이 있으면 묶음 상태 직렬화로 정한다. */
function defaultSideOf(dates: string[], local: EditLayer, incoming: EditLayer): MergeSide {
  const maxOf = (edit: EditLayer): DayEdit | undefined =>
    dates.reduce<DayEdit | undefined>((acc, d) => pickLww(acc, edit.days[d]), undefined);
  const l = maxOf(local);
  const i = maxOf(incoming);
  if (l === undefined) return 'incoming';
  if (i === undefined) return 'local';
  if (JSON.stringify(l) !== JSON.stringify(i)) return pickLww(l, i) === l ? 'local' : 'incoming';
  const stateOf = (edit: EditLayer): string =>
    JSON.stringify(dates.map((d) => edit.days[d] ?? null));
  return stateOf(local) >= stateOf(incoming) ? 'local' : 'incoming';
}

/** §5.4 일정 병합: 날짜 묶음별 채택 또는 충돌. */
function planDays(local: EditLayer, incoming: EditLayer, trip: TripData): GroupPlan[] {
  const dates = sortedUnion(
    trip.days.map((d) => d.date),
    Object.keys(local.days),
    Object.keys(incoming.days),
  );
  const groups = groupDates(
    [
      placementOfTrip(trip),
      placementOfEffective(overlay(trip, local)),
      placementOfEffective(overlay(trip, incoming)),
    ],
    dates,
  );

  return groups.map((group): GroupPlan => {
    const compatible = group.every((d) => {
      const l = local.days[d];
      const i = incoming.days[d];
      return l === undefined || i === undefined || sameDayState(l, i);
    });
    if (compatible) {
      const adopted: Record<string, DayState> = {};
      const tentativeDays: EditLayer['days'] = {};
      for (const d of group) {
        const state = pickLww(local.days[d], incoming.days[d]);
        adopted[d] = state;
        if (state !== undefined) tentativeDays[d] = state;
      }
      const groupSet = new Set(group);
      const effective = overlay(trip, { ...local, days: tentativeDays }).days.filter((day) =>
        groupSet.has(day.date),
      );
      if (findDuplicateStopIds(effective).length === 0)
        return { dates: group, conflict: null, adopted };
    }
    return {
      dates: group,
      conflict: {
        id: group[0]!,
        dates: group,
        defaultSide: defaultSideOf(group, local, incoming),
        promoted: compatible,
      },
    };
  });
}

function summarize(local: EditLayer, incoming: EditLayer, plans: GroupPlan[]): MergeSummary {
  const summary: MergeSummary = {
    memosAdded: 0,
    memosChanged: 0,
    memosDeleted: 0,
    tagChanges: [],
    hiddenChanges: [],
    categoryChanges: [],
    daysAdopted: [],
  };
  for (const placeKey of Object.keys(incoming.places).sort()) {
    const inc = incoming.places[placeKey]!;
    const loc = local.places[placeKey];
    for (const [authorId, im] of Object.entries(inc.memos)) {
      const lm = loc?.memos[authorId];
      if (lm === undefined) {
        if (im.text !== null) summary.memosAdded += 1;
      } else if (incomingWins(lm, im)) {
        if (im.text === null) {
          if (lm.text !== null) summary.memosDeleted += 1;
        } else if (im.text !== lm.text) {
          summary.memosChanged += 1;
        }
      }
    }
    if (inc.tags && incomingWins(loc?.tags, inc.tags)) {
      const from = loc?.tags?.value;
      if (JSON.stringify(from) !== JSON.stringify(inc.tags.value)) {
        summary.tagChanges.push({ placeKey, from, to: inc.tags.value });
      }
    }
    if (inc.hidden && incomingWins(loc?.hidden, inc.hidden)) {
      const from = loc?.hidden?.value;
      if (from !== inc.hidden.value)
        summary.hiddenChanges.push({ placeKey, from, to: inc.hidden.value });
    }
    if (inc.category && incomingWins(loc?.category, inc.category)) {
      const from = loc?.category?.value;
      if ((from ?? null) !== inc.category.value)
        summary.categoryChanges.push({ placeKey, from, to: inc.category.value });
    }
  }
  for (const plan of plans) {
    if (plan.conflict !== null) continue;
    for (const d of plan.dates) {
      const state = plan.adopted[d];
      if (
        state !== undefined &&
        state === incoming.days[d] &&
        !sameDayState(local.days[d], state)
      ) {
        summary.daysAdopted.push(d);
      }
    }
  }
  summary.daysAdopted.sort();
  return summary;
}

/** 미리보기용: 충돌 묶음과 incoming 대 local 변경 요약. 입력은 trip 기준으로 이미 정리돼 있어야 한다. */
export function planMerge(
  local: EditLayer,
  incoming: EditLayer,
  trip: TripData,
): { conflicts: DayConflict[]; summary: MergeSummary } {
  const plans = planDays(local, incoming, trip);
  const conflicts = plans.flatMap((p) => (p.conflict === null ? [] : [p.conflict]));
  return { conflicts, summary: summarize(local, incoming, plans) };
}

/**
 * §5.4 병합. 선택이 없는 충돌은 `defaultSide`. 기본값이 아닌 쪽을 고른 묶음의 DayEdit은
 * `updatedAt = now`로 찍는다. 결과는 스키마·크기 제한·실효 일정 stop id 유일성으로 검증하며,
 * 실패하면 입력을 건드리지 않고 사유를 반환한다.
 */
export function applyMerge(
  local: EditLayer,
  incoming: EditLayer,
  trip: TripData,
  choices: Record<string, MergeSide>,
  now: string,
): MergeResult {
  const days: EditLayer['days'] = {};
  for (const plan of planDays(local, incoming, trip)) {
    if (plan.conflict === null) {
      for (const d of plan.dates) {
        const state = plan.adopted[d];
        if (state !== undefined) days[d] = state;
      }
      continue;
    }
    const { id, defaultSide } = plan.conflict;
    const side = choices[id] ?? defaultSide;
    const source = side === 'local' ? local : incoming;
    for (const d of plan.dates) {
      const state = source.days[d];
      if (state !== undefined)
        days[d] = side === defaultSide ? state : { ...state, updatedAt: now };
    }
  }

  const merged: EditLayer = {
    schemaVersion: local.schemaVersion,
    publicId: local.publicId,
    baseDataVersion: local.baseDataVersion,
    authorId: local.authorId,
    authors: mergeRecordLww(local.authors, incoming.authors),
    places: mergePlaces(local.places, incoming.places),
    days,
  };

  const parsed = safeParse(EditLayerSchema, merged, EDIT_LAYER_PARSE);
  if (!parsed.success) {
    const issue = parsed.issues[0];
    const where = issue ? issue.path : '';
    return {
      ok: false,
      reason: `병합 결과가 유효하지 않아요: ${where} ${issue?.message ?? ''}`.trim(),
    };
  }
  if (isEditLayerTooLarge(parsed.data)) return { ok: false, reason: MERGE_RESULT_TOO_LARGE };
  const duplicates = findDuplicateStopIds(overlay(trip, parsed.data).days);
  if (duplicates.length > 0) {
    return { ok: false, reason: `같은 방문이 두 번 나타나요: ${duplicates.join(', ')}` };
  }
  return { ok: true, edit: parsed.data };
}
