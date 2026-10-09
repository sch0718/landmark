import { addLabels, createLabel, type OpCtx } from 'src/domain/library/ops';
import { liveLabels } from 'src/domain/library/query';
import { effectiveCategory } from 'src/domain/place-category';
import {
  LIBRARY_LIMITS,
  normalizeLabelName,
  type Library,
  type Place,
  type PlaceSource,
} from 'src/schema/library';
import type { EditLayer } from 'src/schema/legacy/edit-layer';
import type { TripData } from 'src/schema/legacy/trip-data';

// 옛 여행(TripData + 편집 레이어) → 보관함 변환(스펙 §4.6, §3 중복 규칙).
// 미리보기와 적용이 같은 계획 함수를 쓰고, 적용 때는 최신 보관함으로 다시 계획해 `semanticKey`로 비교한다.
// 입력을 바꾸지 않는 순수 함수만 둔다.

export type LegacySource = { trip: TripData; edit: EditLayer | null };

/** 키는 옛 라벨 출처 `folder:<folderId>` 또는 `tag:<원문 태그>`. */
export type LabelDecision = { kind: 'use'; name: string } | { kind: 'exclude' };
/** 키는 옛 `placeKey`. */
export type MemoDecision = 'truncate' | 'exclude-place';
export type ImportChoices = {
  labels: Record<string, LabelDecision>;
  memos: Record<string, MemoDecision>;
};

export type PlannedIds = {
  /** placeKey → 새 장소 ID */
  places: Record<string, string>;
  /** 정규화한 라벨 이름 → 새 라벨 ID */
  labels: Record<string, string>;
  now: string;
};

/** 새 장소를 만들 때 쓰는 옛 장소의 값. 의미 비교(`semanticKey`)에는 넣지 않는다(입력 파일에서만 정해진다). */
export type PlannedPlaceBase = {
  source: PlaceSource;
  name: string;
  address: string;
  lng: number;
  lat: number;
};

export type PlannedPlace = {
  placeKey: string;
  action: 'add' | 'merge' | 'exclude';
  /** `add`면 새 ID, `merge`면 라벨을 합칠 기존(또는 같은 가져오기에서 먼저 추가되는) 장소 ID. */
  targetPlaceId: string;
  /** 붙일 라벨의 정규화 이름. */
  labelNames: string[];
  /** `add`일 때만 채운다. 길이 초과를 잘랐다면 잘린 값. */
  memo: string;
  /** `add`일 때만 채운다. 편집을 적용한 실효 분류. */
  category: string | null;
  /** 합친 메모 원문 전체("원문 받기"용). */
  fullMemo: string;
  base: PlannedPlaceBase;
};

export type PlannedLabel = {
  normalizedName: string;
  displayName: string;
  action: 'create' | 'reuse';
  labelId: string;
};

export type PendingDecision =
  | { kind: 'label-name'; key: string; suggested: string; reason: 'empty' | 'too-long' }
  | { kind: 'memo-too-long'; placeKey: string; placeName: string; length: number };

export type ImportPlan = {
  ids: PlannedIds;
  places: PlannedPlace[];
  labels: PlannedLabel[];
  pending: PendingDecision[];
  summary: { added: number; existing: number; newLabels: number; needsDecision: number };
};

export const TRUNCATION_MARK = '…(원문 일부 생략)';

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;

/** 앞 `length`개 코드 단위. 자르는 곳이 서로게이트 쌍의 가운데면 한 단위 앞에서 자른다. */
function cutPrefix(text: string, length: number): string {
  if (length <= 0) return '';
  const end = isHighSurrogate(text.charCodeAt(length - 1)) ? length - 1 : length;
  return text.slice(0, end);
}

/**
 * 한도를 넘으면 본문을 `limit - 생략 표시 길이`만큼 잘라 생략 표시를 붙인다.
 * 길이는 UTF-16 코드 단위(`String.length`)다.
 */
export function truncateMemo(text: string, limit: number = LIBRARY_LIMITS.memoChars): string {
  if (text.length <= limit) return text;
  return cutPrefix(text, limit - TRUNCATION_MARK.length) + TRUNCATION_MARK;
}

/**
 * 장소의 네이버 메모(폴더별)와 편집 레이어 메모(작성자별)를 하나로 합친다.
 * 빈 메모·지운 메모(`text: null`)는 건너뛰고 같은 내용은 하나만 남긴다.
 * 하나뿐이면 그대로, 둘 이상이면 출처 한 줄을 붙여 빈 줄로 잇는다.
 */
export function combineMemos(source: LegacySource, placeKey: string): string {
  const { trip, edit } = source;
  const place = trip.places[placeKey];
  if (place === undefined) return '';

  const entries: { header: string; text: string }[] = [];
  const seen = new Set<string>();
  const add = (header: string, text: string | null | undefined) => {
    if (text === null || text === undefined || text.trim() === '' || seen.has(text)) return;
    seen.add(text);
    entries.push({ header, text });
  };

  for (const memo of place.naverMemos ?? []) {
    const folder = trip.folders.find((f) => f.id === memo.folderId);
    add(`[네이버 · ${folder?.name ?? memo.folderId}]`, memo.memo);
  }
  const edits = edit?.places[placeKey]?.memos ?? {};
  for (const [authorId, memo] of Object.entries(edits)) {
    add(`[${edit?.authors[authorId]?.nickname ?? authorId}]`, memo.text);
  }

  if (entries.length === 0) return '';
  if (entries.length === 1) return entries[0]!.text;
  return entries.map((e) => `${e.header}\n${e.text}`).join('\n\n');
}

// ---------- 계획 ----------

export type LabelSource = { key: string; rawName: string };

type ResolvedLabel =
  { kind: 'ok'; normalized: string; display: string } | { kind: 'excluded' } | { kind: 'pending' };

const NAVER_SID = /^\d+$/;

function baseOf(trip: TripData, placeKey: string): PlannedPlaceBase {
  const lp = trip.places[placeKey]!;
  const source: PlaceSource =
    lp.sid !== undefined && NAVER_SID.test(lp.sid)
      ? { kind: 'naver', sid: lp.sid }
      : { kind: 'pin', legacy: { publicId: trip.publicId, placeKey } };
  return { source, name: lp.name, address: lp.address, lng: lp.lng, lat: lp.lat };
}

/** 이미 있는 살아 있는 장소. 네이버는 `sid`, 핀은 `source.legacy`로 찾는다. */
function findExisting(lib: Library, source: PlaceSource): Place | undefined {
  return Object.values(lib.places).find((p) => {
    if (p.deletedAt !== null) return false;
    if (source.kind === 'naver') return p.source.kind === 'naver' && p.source.sid === source.sid;
    return (
      p.source.kind === 'pin' &&
      p.source.legacy !== undefined &&
      source.legacy !== undefined &&
      p.source.legacy.publicId === source.legacy.publicId &&
      p.source.legacy.placeKey === source.legacy.placeKey
    );
  });
}

function labelSourcesOf(source: LegacySource, placeKey: string): LabelSource[] {
  const { trip, edit } = source;
  const place = trip.places[placeKey]!;
  const out: LabelSource[] = [];
  for (const folderId of place.folderIds) {
    const folder = trip.folders.find((f) => f.id === folderId);
    if (folder !== undefined) out.push({ key: `folder:${folderId}`, rawName: folder.name });
  }
  for (const tag of edit?.places[placeKey]?.tags?.value ?? []) {
    out.push({ key: `tag:${tag}`, rawName: tag });
  }
  return out;
}

/** 옛 여행 전체가 쓰는 라벨 출처(폴더·태그), 처음 나온 순서·키 중복 없이. 화면이 이름 겹침을 검사하는 데 쓴다. */
export function legacyLabelSources(source: LegacySource): LabelSource[] {
  const byKey = new Map<string, LabelSource>();
  for (const placeKey of Object.keys(source.trip.places)) {
    for (const labelSource of labelSourcesOf(source, placeKey)) {
      if (!byKey.has(labelSource.key)) byKey.set(labelSource.key, labelSource);
    }
  }
  return [...byKey.values()];
}

/** 라벨 출처 키 → 그 출처를 쓰는 옛 장소 키들. 화면이 제외된 장소만 쓰는 출처를 가려내는 데 쓴다. */
export function legacyLabelPlaceKeys(source: LegacySource): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const placeKey of Object.keys(source.trip.places)) {
    for (const { key } of labelSourcesOf(source, placeKey)) {
      const keys = byKey.get(key);
      if (keys === undefined) byKey.set(key, [placeKey]);
      else if (!keys.includes(placeKey)) keys.push(placeKey);
    }
  }
  return byKey;
}

export function planLegacyImport(
  lib: Library,
  source: LegacySource,
  choices: ImportChoices,
  ids: PlannedIds | null,
  newId: (kind: 'place' | 'label') => string,
  now: string,
): ImportPlan {
  const { trip, edit } = source;
  const pending: PendingDecision[] = [];
  const outIds: PlannedIds = {
    places: { ...ids?.places },
    labels: { ...ids?.labels },
    now: ids?.now ?? now,
  };

  // 1) 장소별 동작
  const places: PlannedPlace[] = [];
  const addedBySid = new Map<string, string>();
  for (const [placeKey, lp] of Object.entries(trip.places)) {
    const base = baseOf(trip, placeKey);
    const fullMemo = combineMemos(source, placeKey);
    const common = { placeKey, labelNames: [] as string[], fullMemo, base };

    const tooLong = fullMemo.length > LIBRARY_LIMITS.memoChars;
    const decision = choices.memos[placeKey];
    // 사용자가 제외하기로 한 장소는 그 사이 다른 탭이 같은 장소를 저장했더라도 제외로 둔다.
    if (tooLong && decision === 'exclude-place') {
      const targetPlaceId = (outIds.places[placeKey] ??= newId('place'));
      places.push({ ...common, action: 'exclude', targetPlaceId, memo: '', category: null });
      continue;
    }

    const existing = findExisting(lib, base.source);
    const sidKey = base.source.kind === 'naver' ? base.source.sid : null;
    const earlier = sidKey === null ? undefined : addedBySid.get(sidKey);
    if (existing !== undefined || earlier !== undefined) {
      places.push({
        ...common,
        action: 'merge',
        targetPlaceId: existing?.id ?? earlier!,
        memo: '',
        category: null,
      });
      continue;
    }

    const targetPlaceId = (outIds.places[placeKey] ??= newId('place'));
    if (tooLong && decision === undefined) {
      pending.push({
        kind: 'memo-too-long',
        placeKey,
        placeName: lp.name,
        length: fullMemo.length,
      });
    }
    if (sidKey !== null) addedBySid.set(sidKey, targetPlaceId);
    places.push({
      ...common,
      action: 'add',
      targetPlaceId,
      memo: tooLong ? truncateMemo(fullMemo) : fullMemo,
      category: effectiveCategory(lp, edit?.places[placeKey]),
    });
  }

  // 2) 라벨: 제외되지 않은 장소가 쓰는 출처만, 처음 나온 순서대로
  const resolved = new Map<string, ResolvedLabel>();
  const resolve = ({ key, rawName }: LabelSource): ResolvedLabel => {
    const known = resolved.get(key);
    if (known !== undefined) return known;
    const decision = choices.labels[key];
    let result: ResolvedLabel;
    if (decision?.kind === 'exclude') {
      result = { kind: 'excluded' };
    } else {
      const trimmed = (decision?.kind === 'use' ? decision.name : rawName).trim();
      if (trimmed === '' || trimmed.length > LIBRARY_LIMITS.labelNameChars) {
        pending.push({
          kind: 'label-name',
          key,
          suggested: cutPrefix(trimmed, LIBRARY_LIMITS.labelNameChars),
          reason: trimmed === '' ? 'empty' : 'too-long',
        });
        result = { kind: 'pending' };
      } else {
        result = { kind: 'ok', normalized: normalizeLabelName(trimmed), display: trimmed };
      }
    }
    resolved.set(key, result);
    return result;
  };

  const liveByName = new Map(liveLabels(lib).map((l) => [normalizeLabelName(l.name.value), l]));
  const labels = new Map<string, PlannedLabel>();
  for (const place of places) {
    if (place.action === 'exclude') continue;
    const names = new Set<string>();
    for (const labelSource of labelSourcesOf(source, place.placeKey)) {
      const r = resolve(labelSource);
      if (r.kind !== 'ok') continue;
      names.add(r.normalized);
      if (labels.has(r.normalized)) continue;
      const existing = liveByName.get(r.normalized);
      labels.set(
        r.normalized,
        existing !== undefined
          ? {
              normalizedName: r.normalized,
              displayName: existing.name.value,
              action: 'reuse',
              labelId: existing.id,
            }
          : {
              normalizedName: r.normalized,
              displayName: r.display,
              action: 'create',
              labelId: (outIds.labels[r.normalized] ??= newId('label')),
            },
      );
    }
    place.labelNames = [...names];
  }

  const planned = [...labels.values()];
  return {
    ids: outIds,
    places,
    labels: planned,
    pending,
    summary: {
      added: places.filter((p) => p.action === 'add').length,
      existing: places.filter((p) => p.action === 'merge').length,
      newLabels: planned.filter((l) => l.action === 'create').length,
      needsDecision: pending.length,
    },
  };
}

/**
 * 계획에서 휘발성 값(새로 만든 ID·시각)을 빼고 §4.6의 비교 대상만 정렬해 직렬화한다.
 * 기존 장소·라벨 ID는 보관함 상태를 반영하므로 넣는다.
 */
export function semanticKey(plan: ImportPlan): string {
  const minted = new Set(Object.values(plan.ids.places));
  const byKey = <T>(items: T[], key: (item: T) => string): T[] =>
    [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return JSON.stringify({
    places: byKey(plan.places, (p) => p.placeKey).map((p) => [
      p.placeKey,
      p.action,
      p.action === 'merge' ? (minted.has(p.targetPlaceId) ? '@new' : p.targetPlaceId) : null,
      [...p.labelNames].sort(),
      p.memo,
      p.category,
    ]),
    labels: byKey(plan.labels, (l) => l.normalizedName).map((l) => [
      l.normalizedName,
      l.action,
      l.action === 'create' ? l.displayName : l.labelId,
    ]),
    pending: byKey(
      plan.pending.map((d) => JSON.stringify(d)),
      (s) => s,
    ),
  });
}

/** 계획을 보관함에 적용한 새 문서. `pending`이 남아 있으면 호출 측 버그이므로 던진다. */
export function applyImportPlan(lib: Library, plan: ImportPlan): Library {
  if (plan.pending.length > 0) {
    throw new Error(`확인이 필요한 항목이 ${plan.pending.length}개 남아 있어요`);
  }
  const now = plan.ids.now;

  const labelIds = new Map<string, string>();
  let next = lib;
  for (const planned of plan.labels) {
    if (planned.action === 'reuse') {
      const label = next.labels[planned.labelId];
      if (label === undefined || label.deletedAt !== null) {
        throw new Error(`재사용할 라벨이 없어요: ${planned.labelId}`);
      }
    } else {
      const ctx: OpCtx = { now, newId: () => planned.labelId };
      const created = createLabel(next, planned.displayName, ctx);
      if (!created.ok) throw new Error(`라벨을 만들 수 없어요: ${planned.displayName}`);
      next = created.lib;
    }
    labelIds.set(planned.normalizedName, planned.labelId);
  }

  const idsOf = (names: readonly string[]): string[] =>
    names.flatMap((n) => {
      const id = labelIds.get(n);
      return id === undefined ? [] : [id];
    });

  const added: Record<string, Place> = {};
  for (const p of plan.places) {
    if (p.action !== 'add') continue;
    added[p.targetPlaceId] = {
      id: p.targetPlaceId,
      source: p.base.source,
      name: { value: p.base.name, updatedAt: now },
      address: p.base.address,
      lng: p.base.lng,
      lat: p.base.lat,
      category: { value: p.category, updatedAt: now },
      labelIds: { value: idsOf(p.labelNames), updatedAt: now },
      memo: { value: p.memo, updatedAt: now },
      saved: { value: true, updatedAt: now },
      createdAt: now,
      deletedAt: null,
    };
  }
  next = { ...next, places: { ...next.places, ...added } };

  const ctx: OpCtx = {
    now,
    newId: () => {
      throw new Error('가져오기 적용 중에는 새 ID를 만들지 않아요');
    },
  };
  for (const p of plan.places) {
    if (p.action !== 'merge') continue;
    next = addLabels(next, [p.targetPlaceId], idsOf(p.labelNames), ctx);
  }
  return next;
}
