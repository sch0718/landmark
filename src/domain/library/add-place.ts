import { truncateMemo } from 'src/domain/library/legacy-import';
import { setField } from 'src/domain/library/lww';
import {
  createLabel,
  type OpCtx,
  type OpError,
  type OpResult,
  type OpSummary,
} from 'src/domain/library/ops';
import { liveLabels } from 'src/domain/library/query';
import {
  LABEL_COLORS,
  LIBRARY_LIMITS,
  normalizeLabelName,
  type Label,
  type Library,
  type Place,
  type PlaceSource,
} from 'src/schema/library';

// 링크·핀·네이버 공유 폴더로 장소를 넣는 연산(스펙 §3.3~§3.5).
// `ops.ts`와 같이 입력을 바꾸지 않는 순수 함수이며, `LibraryStore.update` 안에서 최신본에 적용한다.
// 중복 판단도 여기서 최신본 기준으로 다시 하므로 다른 탭과 동시에 넣어도 중복이 생기지 않는다.

/** 링크 결과나 핀으로 만든 추가 후보. */
export type PlaceCandidate = {
  source: PlaceSource;
  name: string;
  address: string;
  lng: number;
  lat: number;
  category: string | null;
};

/** 네이버 공유 폴더의 장소 하나. */
export type FolderItem = {
  sid: string;
  name: string;
  address: string;
  lng: number;
  lat: number;
  memo: string;
};

/** 미리보기용 분류. `merge`는 지금 보관함에 보이는(살아 있는) 장소와 같은 `sid`인 항목이다. */
export type FolderPlan = { create: FolderItem[]; merge: { item: FolderItem; placeId: string }[] };

type Outcome = 'created' | 'merged' | 'restored';

const fail = (error: OpError): Extract<OpResult, { ok: false }> => ({ ok: false, error });

/**
 * 출처의 중복 판단 키. 서비스가 다르면 번호가 같아도 키가 다르다.
 * 직접 찍은 핀(`legacy` 없음)은 중복을 판단하지 않으므로 `null`이다.
 */
export function sourceKey(source: PlaceSource): string | null {
  switch (source.kind) {
    case 'naver':
      return `naver:${source.sid}`;
    case 'kakao':
      return `kakao:${source.kakaoId}`;
    case 'google':
      return `google:${source.googleId}`;
    case 'pin':
      return source.legacy === undefined
        ? null
        : `pin:${source.legacy.publicId}/${source.legacy.placeKey}`;
  }
}

/** 앞쪽이 더 맞는 기존 장소인가: 살아 있는 것 > 늦게 지운 것. */
function preferred(a: Place, b: Place): boolean {
  if (a.deletedAt === null || b.deletedAt === null)
    return a.deletedAt === null && b.deletedAt !== null;
  return a.deletedAt > b.deletedAt;
}

/** 출처 키 → 그 출처의 기존 장소(`findExisting`과 같은 우선순위). 폴더처럼 여러 번 찾을 때 한 번만 훑는다. */
export function indexBySource(lib: Library): Map<string, Place> {
  const index = new Map<string, Place>();
  for (const place of Object.values(lib.places)) {
    const key = sourceKey(place.source);
    if (key === null) continue;
    const current = index.get(key);
    if (current === undefined || preferred(place, current)) index.set(key, place);
  }
  return index;
}

/**
 * 같은 출처의 장소. 살아 있는 것을 먼저 찾고, 없으면 지운 것 중 가장 늦게 지운 것을 돌려준다.
 * (옛 여행 가져오기의 `legacy-import.ts` 내부 `findExisting`은 살아 있는 장소만 찾는 별개 함수다.)
 */
export function findExisting(lib: Library, source: PlaceSource): Place | undefined {
  const key = sourceKey(source);
  return key === null ? undefined : indexBySource(lib).get(key);
}

export function newPlace(
  id: string,
  base: PlaceCandidate,
  labelIds: readonly string[],
  memo: string,
  now: string,
  saved = true,
): Place {
  return {
    id,
    source: base.source,
    name: { value: base.name, updatedAt: now },
    address: base.address,
    lng: base.lng,
    lat: base.lat,
    category: { value: base.category, updatedAt: now },
    labelIds: { value: [...labelIds], updatedAt: now },
    memo: { value: truncateMemo(memo), updatedAt: now },
    saved: { value: saved, updatedAt: now },
    createdAt: now,
    deletedAt: null,
  };
}

export const isLiveLabel = (lib: Library, id: string): boolean => {
  const label = lib.labels[id];
  return label !== undefined && label.deletedAt === null;
};

/** 기존 메모 뒤에 줄바꿈 후 덧붙인다. 끝이 이미 같은 내용이면 그대로 둔다. */
function appendMemo(current: string, added: string): string {
  if (added === '') return current;
  if (current === '') return truncateMemo(added);
  if (current === added || current.endsWith(`\n${added}`)) return current;
  return truncateMemo(`${current}\n${added}`);
}

/**
 * 이미 있는 장소(지운 것이면 되살린다)에 라벨을 더하고, `memo`가 있으면 덧붙인다.
 * 이름·주소·분류는 바꾸지 않는다. 되살릴 때는 그사이 지워진 라벨을 뗀다(살아 있는 장소의 불변식).
 * `save`가 거짓이면(여행에만 넣기) `saved`는 지금 값 그대로 둔다.
 * `memo`가 함수면 지금 메모를 받아 새 메모를 돌려준다(공유 파일 가져오기의 덧붙이기 규칙).
 */
export function mergeInto(
  lib: Library,
  place: Place,
  labelIds: readonly string[],
  memo: string | ((current: string) => string),
  now: string,
  save = true,
): Place {
  const kept = place.labelIds.value.filter((id) => isLiveLabel(lib, id));
  const labels = setField(place.labelIds, [...new Set([...kept, ...labelIds])], now);
  const nextMemo =
    typeof memo === 'string' ? appendMemo(place.memo.value, memo) : memo(place.memo.value);
  const memoField = setField(place.memo, nextMemo, now);
  // 여행에서만 쓰던 장소(`saved: false`)도 보관함에 넣는 것이므로 보이게 한다.
  const saved = save ? setField(place.saved, true, now) : place.saved;
  const unchanged =
    labels === place.labelIds &&
    memoField === place.memo &&
    saved === place.saved &&
    place.deletedAt === null;
  return unchanged
    ? place
    : { ...place, labelIds: labels, memo: memoField, saved, deletedAt: null };
}

/** 후보 하나의 결과 장소. 보관함 문서는 호출한 쪽이 한 번에 갈아 끼운다. */
function putPlace(
  lib: Library,
  existing: Place | undefined,
  candidate: PlaceCandidate,
  labelIds: readonly string[],
  memo: { forNew: string; forExisting: string },
  ctx: OpCtx,
  saved = true,
): { place: Place; outcome: Outcome } {
  if (existing === undefined) {
    const place = newPlace(ctx.newId('place'), candidate, labelIds, memo.forNew, ctx.now, saved);
    return { place, outcome: 'created' };
  }
  return {
    place: mergeInto(lib, existing, labelIds, memo.forExisting, ctx.now, saved),
    outcome: existing.deletedAt === null ? 'merged' : 'restored',
  };
}

/**
 * 링크·핀 후보를 넣는다. 같은 출처의 장소가 있으면 새로 만들지 않고 라벨을 더하고 메모를 덧붙인다(지운 것이면 되살린다).
 * `createdId`는 결과 장소 id다(새로 만든 것·합친 것·되살린 것 모두).
 * `saved`(기본 참)가 거짓이면 새 장소는 보관함 목록에서 숨긴 장소(`saved: false`)로 만들고,
 * 이미 있는 장소는 `saved`를 바꾸지 않는다(보이던 장소를 숨기지도, 숨긴 장소를 보이게 하지도 않는다).
 */
export function addPlace(
  lib: Library,
  candidate: PlaceCandidate,
  input: { labelIds: string[]; memo: string; saved?: boolean },
  ctx: OpCtx,
): OpResult {
  const missing = input.labelIds.find((id) => !isLiveLabel(lib, id));
  if (missing !== undefined) return fail({ _tag: 'NotFound', id: missing });
  const memo = input.memo.trim();
  const labelIds = [...new Set(input.labelIds)];
  const existing = findExisting(lib, candidate.source);
  const { place } = putPlace(
    lib,
    existing,
    candidate,
    labelIds,
    { forNew: memo, forExisting: memo },
    ctx,
    input.saved ?? true,
  );
  return {
    ok: true,
    lib: { ...lib, places: { ...lib.places, [place.id]: place } },
    createdId: place.id,
  };
}

const folderKey = (item: FolderItem): string => sourceKey({ kind: 'naver', sid: item.sid })!;

/** 같은 `sid`가 여러 번 나오면 처음 것만 남긴다. */
function uniqueBySid(items: readonly FolderItem[]): FolderItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.sid)) return false;
    seen.add(item.sid);
    return true;
  });
}

/**
 * 미리보기의 `이미 있음` 표시용 분류. 지운 장소는 화면에 없으므로 `create`에 넣는다(가져오면 되살아난다).
 * 실제 개수는 `importFolder`의 `summary`를 쓴다.
 */
export function planFolderImport(lib: Library, items: FolderItem[]): FolderPlan {
  const plan: FolderPlan = { create: [], merge: [] };
  const index = indexBySource(lib);
  for (const item of uniqueBySid(items)) {
    const existing = index.get(folderKey(item));
    if (existing !== undefined && existing.deletedAt === null) {
      plan.merge.push({ item, placeId: existing.id });
    } else {
      plan.create.push(item);
    }
  }
  return plan;
}

/** 살아 있는 라벨이 쓰지 않은 첫 색. 모두 쓰였으면 순서가 가장 뒤인 라벨 색의 다음 색. */
export function nextLabelColor(lib: Library): Label['color']['value'] {
  const live = liveLabels(lib);
  const used = new Set(live.map((l) => l.color.value));
  const unused = LABEL_COLORS.find((c) => !used.has(c));
  if (unused !== undefined) return unused;
  const last = live[live.length - 1]!;
  return LABEL_COLORS[(LABEL_COLORS.indexOf(last.color.value) + 1) % LABEL_COLORS.length]!;
}

/** 정규형이 같은 살아 있는 라벨. */
export function findLiveLabel(lib: Library, name: string): Label | undefined {
  const wanted = normalizeLabelName(name);
  return liveLabels(lib).find((l) => normalizeLabelName(l.name.value) === wanted);
}

/**
 * 이름으로 라벨을 정한다. 정규형이 같은 살아 있는 라벨이 있으면 그것을 쓰고(색·순서 그대로),
 * 없으면 `color`로 맨 뒤에 만든다. 다듬은 이름이 1–30자가 아니면 `LabelNameInvalid`다.
 */
export function reuseOrCreateLabel(
  lib: Library,
  name: string,
  color: Label['color']['value'],
  ctx: OpCtx,
): { ok: true; lib: Library; labelId: string } | Extract<OpResult, { ok: false }> {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > LIBRARY_LIMITS.labelNameChars) {
    return fail({ _tag: 'LabelNameInvalid', name });
  }
  const reused = findLiveLabel(lib, trimmed);
  if (reused !== undefined) return { ok: true, lib, labelId: reused.id };

  const created = createLabel(lib, trimmed, ctx);
  if (!created.ok) return created;
  const id = created.createdId!;
  const made = created.lib.labels[id]!;
  return {
    ok: true,
    lib: {
      ...created.lib,
      labels: {
        ...created.lib.labels,
        [id]: { ...made, color: { value: color, updatedAt: ctx.now } },
      },
    },
    labelId: id,
  };
}

/** 폴더 라벨을 정한다. 이름이면 정규형이 같은 살아 있는 라벨을 쓰고, 없으면 만든다. */
function resolveFolderLabel(
  lib: Library,
  label: { labelId: string } | { newLabelName: string },
  ctx: OpCtx,
): { ok: true; lib: Library; labelId: string } | Extract<OpResult, { ok: false }> {
  if ('labelId' in label) {
    return isLiveLabel(lib, label.labelId)
      ? { ok: true, lib, labelId: label.labelId }
      : fail({ _tag: 'NotFound', id: label.labelId });
  }
  return reuseOrCreateLabel(lib, label.newLabelName, nextLabelColor(lib), ctx);
}

/**
 * 네이버 공유 폴더의 장소들을 한 라벨로 넣는다. 새 장소에만 폴더 메모를 넣고,
 * 이미 있는 장소(지운 것은 되살린다)에는 라벨만 더한다.
 * `createdId`는 쓴 라벨 id, `summary`는 이 연산이 최신본에 적용하며 직접 센 개수다.
 */
export function importFolder(
  lib: Library,
  items: FolderItem[],
  label: { labelId: string } | { newLabelName: string },
  ctx: OpCtx,
): OpResult {
  const resolved = resolveFolderLabel(lib, label, ctx);
  if (!resolved.ok) return resolved;
  const base = resolved.lib;
  const index = indexBySource(base);
  const changed: Record<string, Place> = {};
  const summary: OpSummary = { created: 0, merged: 0, restored: 0 };
  // 항목의 `sid`가 서로 다르므로 각 항목은 원래 문서의 기존 장소만 보면 된다.
  for (const item of uniqueBySid(items)) {
    const candidate: PlaceCandidate = {
      source: { kind: 'naver', sid: item.sid },
      name: item.name,
      address: item.address,
      lng: item.lng,
      lat: item.lat,
      category: null,
    };
    const existing = index.get(folderKey(item));
    const { place, outcome } = putPlace(
      base,
      existing,
      candidate,
      [resolved.labelId],
      { forNew: item.memo, forExisting: '' },
      ctx,
    );
    changed[place.id] = place;
    summary[outcome] += 1;
  }
  return {
    ok: true,
    lib: { ...base, places: { ...base.places, ...changed } },
    createdId: resolved.labelId,
    summary,
  };
}
