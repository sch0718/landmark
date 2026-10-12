import { setField } from 'src/domain/library/lww';
import { liveLabels } from 'src/domain/library/query';
import {
  LABEL_COLORS,
  LIBRARY_LIMITS,
  normalizeLabelName,
  type Label,
  LabelColor,
  LabelIcon,
  type Library,
  type Place,
} from 'src/schema/library';
import type { IdKind } from 'src/services/id-gen';
import type { TripOpError } from 'src/domain/trips/ops';

// 보관함 문서를 바꾸는 유일한 경로(스펙 §6.1). 모두 입력을 바꾸지 않는 순수 함수이며,
// 바뀐 필드만 `updatedAt = ctx.now`로 갱신하고 나머지는 같은 참조로 둔다.

export type OpCtx = { now: string; newId: (kind: IdKind) => string };

export type OpError =
  | { _tag: 'LabelNameTaken'; name: string }
  | { _tag: 'LabelNameInvalid'; name: string }
  | { _tag: 'NotFound'; id: string }
  | TripOpError;

/** 여러 장소를 한 번에 넣는 연산(폴더 가져오기)이 직접 센 결과. */
export type OpSummary = { created: number; merged: number; restored: number };

export type OpResult =
  | { ok: true; lib: Library; createdId?: string; summary?: OpSummary }
  | { ok: false; error: OpError };

const fail = (error: OpError): OpResult => ({ ok: false, error });

// ---------- 공통 ----------

/** 순서를 유지한 채 중복을 없앤다. */
function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function withPlaces(lib: Library, changed: Record<string, Place>): Library {
  return Object.keys(changed).length === 0
    ? lib
    : { ...lib, places: { ...lib.places, ...changed } };
}

function withLabels(lib: Library, changed: Record<string, Label>): Library {
  return Object.keys(changed).length === 0
    ? lib
    : { ...lib, labels: { ...lib.labels, ...changed } };
}

/** `update`가 바뀐 장소만 돌려주도록 하는 장소 일괄 변경. 없는 id는 건너뛴다. */
function updatePlaces(
  lib: Library,
  placeIds: readonly string[],
  update: (place: Place) => Place,
): Library {
  const changed: Record<string, Place> = {};
  for (const id of dedupe(placeIds)) {
    const place = lib.places[id];
    if (place === undefined) continue;
    const next = update(place);
    if (next !== place) changed[id] = next;
  }
  return withPlaces(lib, changed);
}

function updateLabel(lib: Library, labelId: string, update: (label: Label) => Label): Library {
  const label = lib.labels[labelId];
  if (label === undefined || label.deletedAt !== null) return lib;
  const next = update(label);
  return next === label ? lib : withLabels(lib, { [labelId]: next });
}

/** 장소의 라벨 목록을 `ids`로 바꾼다. 같으면 같은 장소를 돌려준다. */
function withLabelIds(place: Place, ids: readonly string[], now: string): Place {
  const labelIds = setField(place.labelIds, [...ids], now);
  return labelIds === place.labelIds ? place : { ...place, labelIds };
}

/** 이름을 다듬고 길이를 검사한다. 검사는 다듬은 값 기준이다. */
function validName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= LIBRARY_LIMITS.labelNameChars ? trimmed : null;
}

function findLiveLabelByName(lib: Library, name: string, exceptId?: string): Label | undefined {
  const wanted = normalizeLabelName(name);
  return liveLabels(lib).find(
    (l) => l.id !== exceptId && normalizeLabelName(l.name.value) === wanted,
  );
}

function liveLabelIds(lib: Library, labelIds: readonly string[]): string[] {
  return dedupe(labelIds).filter((id) => {
    const label = lib.labels[id];
    return label !== undefined && label.deletedAt === null;
  });
}

// ---------- 장소 ----------

export function setPlaceName(lib: Library, placeId: string, name: string, ctx: OpCtx): Library {
  return updatePlaces(lib, [placeId], (p) => {
    const field = setField(p.name, name, ctx.now);
    return field === p.name ? p : { ...p, name: field };
  });
}

export function setPlaceCategory(
  lib: Library,
  placeId: string,
  category: string | null,
  ctx: OpCtx,
): Library {
  return updatePlaces(lib, [placeId], (p) => {
    const field = setField(p.category, category, ctx.now);
    return field === p.category ? p : { ...p, category: field };
  });
}

export function setPlaceMemo(lib: Library, placeId: string, memo: string, ctx: OpCtx): Library {
  return updatePlaces(lib, [placeId], (p) => {
    const field = setField(p.memo, memo, ctx.now);
    return field === p.memo ? p : { ...p, memo: field };
  });
}

/** 붙어 있으면 떼고, 없으면 끝에 붙인다. 지워진 라벨은 붙이지 않는다. */
export function toggleLabel(lib: Library, placeId: string, labelId: string, ctx: OpCtx): Library {
  return updatePlaces(lib, [placeId], (p) => {
    const current = p.labelIds.value;
    if (current.includes(labelId)) {
      return withLabelIds(
        p,
        current.filter((id) => id !== labelId),
        ctx.now,
      );
    }
    return withLabelIds(p, [...dedupe(current), ...liveLabelIds(lib, [labelId])], ctx.now);
  });
}

/** 여러 장소에 여러 라벨을 붙인다. 이미 붙은 것·지워진 라벨은 건너뛴다. */
export function addLabels(
  lib: Library,
  placeIds: string[],
  labelIds: string[],
  ctx: OpCtx,
): Library {
  const toAdd = liveLabelIds(lib, labelIds);
  return updatePlaces(lib, placeIds, (p) =>
    withLabelIds(p, dedupe([...p.labelIds.value, ...toAdd]), ctx.now),
  );
}

export function removeLabels(
  lib: Library,
  placeIds: string[],
  labelIds: string[],
  ctx: OpCtx,
): Library {
  const toRemove = new Set(labelIds);
  return updatePlaces(lib, placeIds, (p) =>
    withLabelIds(
      p,
      p.labelIds.value.filter((id) => !toRemove.has(id)),
      ctx.now,
    ),
  );
}

/** 지운 시각을 남긴다. 이미 지운 장소는 처음 지운 시각을 유지한다. */
export function deletePlaces(lib: Library, placeIds: string[], ctx: OpCtx): Library {
  return updatePlaces(lib, placeIds, (p) =>
    p.deletedAt === null ? { ...p, deletedAt: ctx.now } : p,
  );
}

// 되살리는 데는 시각이 필요 없지만, 모든 변경 함수가 같은 모양(lib, ..., ctx)을 갖도록 `ctx`를 받는다.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function restorePlaces(lib: Library, placeIds: string[], _ctx: OpCtx): Library {
  return updatePlaces(lib, placeIds, (p) => (p.deletedAt === null ? p : { ...p, deletedAt: null }));
}

// ---------- 라벨 ----------

export function createLabel(lib: Library, name: string, ctx: OpCtx): OpResult {
  const trimmed = validName(name);
  if (trimmed === null) return fail({ _tag: 'LabelNameInvalid', name });
  if (findLiveLabelByName(lib, trimmed) !== undefined) {
    return fail({ _tag: 'LabelNameTaken', name: trimmed });
  }
  const live = liveLabels(lib);
  const id = ctx.newId('label');
  const label: Label = {
    id,
    name: { value: trimmed, updatedAt: ctx.now },
    color: { value: LABEL_COLORS[live.length % LABEL_COLORS.length]!, updatedAt: ctx.now },
    icon: { value: 'star', updatedAt: ctx.now },
    order: {
      value: live.reduce((max, l) => Math.max(max, l.order.value), -1) + 1,
      updatedAt: ctx.now,
    },
    createdAt: ctx.now,
    deletedAt: null,
  };
  return { ok: true, lib: withLabels(lib, { [id]: label }), createdId: id };
}

export function renameLabel(lib: Library, labelId: string, name: string, ctx: OpCtx): OpResult {
  const label = lib.labels[labelId];
  if (label === undefined || label.deletedAt !== null) {
    return fail({ _tag: 'NotFound', id: labelId });
  }
  const trimmed = validName(name);
  if (trimmed === null) return fail({ _tag: 'LabelNameInvalid', name });
  if (findLiveLabelByName(lib, trimmed, labelId) !== undefined) {
    return fail({ _tag: 'LabelNameTaken', name: trimmed });
  }
  return {
    ok: true,
    lib: updateLabel(lib, labelId, (l) => {
      const field = setField(l.name, trimmed, ctx.now);
      return field === l.name ? l : { ...l, name: field };
    }),
  };
}

export function setLabelColor(
  lib: Library,
  labelId: string,
  color: typeof LabelColor.Type,
  ctx: OpCtx,
): Library {
  return updateLabel(lib, labelId, (l) => {
    const field = setField(l.color, color, ctx.now);
    return field === l.color ? l : { ...l, color: field };
  });
}

export function setLabelIcon(
  lib: Library,
  labelId: string,
  icon: typeof LabelIcon.Type,
  ctx: OpCtx,
): Library {
  return updateLabel(lib, labelId, (l) => {
    const field = setField(l.icon, icon, ctx.now);
    return field === l.icon ? l : { ...l, icon: field };
  });
}

/**
 * 살아 있는 라벨의 순서를 `orderedIds` 순으로 0, 1, 2…로 다시 매긴다.
 * 목록에 없는 살아 있는 라벨은 기존 순서대로 뒤에 둔다. 모르는 id는 무시한다.
 */
export function reorderLabels(lib: Library, orderedIds: string[], ctx: OpCtx): Library {
  const live = liveLabels(lib);
  const liveIds = new Set(live.map((l) => l.id));
  const ids = [
    ...dedupe(orderedIds).filter((id) => liveIds.has(id)),
    ...live.map((l) => l.id).filter((id) => !orderedIds.includes(id)),
  ];
  const changed: Record<string, Label> = {};
  ids.forEach((id, index) => {
    const label = lib.labels[id]!;
    const order = setField(label.order, index, ctx.now);
    if (order !== label.order) changed[id] = { ...label, order };
  });
  return withLabels(lib, changed);
}

/** 모든 장소(지운 장소 포함)의 라벨 목록에서 `from`을 `into`로 바꾸거나(`into` 없으면 제거) 뺀다. */
function rewritePlaceLabels(lib: Library, from: string, into: string | null, ctx: OpCtx): Library {
  const holders = Object.values(lib.places)
    .filter((p) => p.labelIds.value.includes(from))
    .map((p) => p.id);
  return updatePlaces(lib, holders, (p) => {
    const next: string[] = [];
    for (const id of p.labelIds.value) {
      const mapped = id === from ? into : id;
      if (mapped !== null && !next.includes(mapped)) next.push(mapped);
    }
    return withLabelIds(p, next, ctx.now);
  });
}

function tombstoneLabel(lib: Library, labelId: string, ctx: OpCtx): Library {
  return withLabels(lib, { [labelId]: { ...lib.labels[labelId]!, deletedAt: ctx.now } });
}

/** 라벨을 지우고(삭제 표시) 모든 장소에서 뗀다. 장소는 남는다. */
export function deleteLabel(lib: Library, labelId: string, ctx: OpCtx): Library {
  const label = lib.labels[labelId];
  if (label === undefined || label.deletedAt !== null) return lib;
  return tombstoneLabel(rewritePlaceLabels(lib, labelId, null, ctx), labelId, ctx);
}

/** `from`이 붙은 장소에 `into`를 한 번만 붙이고 `from`을 지운다. */
export function mergeLabels(lib: Library, fromId: string, intoId: string, ctx: OpCtx): Library {
  const from = lib.labels[fromId];
  const into = lib.labels[intoId];
  if (fromId === intoId) return lib;
  if (from === undefined || from.deletedAt !== null) return lib;
  if (into === undefined || into.deletedAt !== null) return lib;
  return tombstoneLabel(rewritePlaceLabels(lib, fromId, intoId, ctx), fromId, ctx);
}

/**
 * 이름이 같은(정규화) 살아 있는 라벨이 있으면 그 라벨을, 없으면 새로 만들어 장소에 붙인다.
 * `createdId`는 새로 만든 경우에만 있다.
 */
export function createAndAttachLabel(
  lib: Library,
  placeId: string,
  name: string,
  ctx: OpCtx,
): OpResult {
  if (lib.places[placeId] === undefined) return fail({ _tag: 'NotFound', id: placeId });
  const trimmed = validName(name);
  if (trimmed === null) return fail({ _tag: 'LabelNameInvalid', name });
  const existing = findLiveLabelByName(lib, trimmed);
  if (existing !== undefined) {
    return { ok: true, lib: addLabels(lib, [placeId], [existing.id], ctx) };
  }
  const created = createLabel(lib, trimmed, ctx);
  if (!created.ok) return created;
  return {
    ok: true,
    lib: addLabels(created.lib, [placeId], [created.createdId!], ctx),
    createdId: created.createdId,
  };
}
