import {
  indexBySource,
  mergeInto,
  newPlace,
  nextLabelColor,
  sourceKey,
  type PlaceCandidate,
} from 'src/domain/library/add-place';
import {
  createLabel,
  type OpCtx,
  type OpError,
  type OpResult,
  type OpSummary,
} from 'src/domain/library/ops';
import { liveLabels } from 'src/domain/library/query';
import { haversineM } from 'src/domain/trips/geo';
import { is } from 'src/schema/parse';
import {
  LIBRARY_LIMITS,
  normalizeLabelName,
  PlaceSource,
  type Label,
  type LabelColor,
  type Library,
  type Place,
} from 'src/schema/library';
import type { ShareDoc, ShareLabel, SharePlace } from 'src/schema/share';

// 받은 공유 파일을 내 보관함과 합치는 연산(스펙 §3). `add-place.ts`와 같이 입력을 바꾸지 않는 순수 함수이며,
// `importShare`는 `LibraryStore.update` 안에서 최신본에 적용한다. `planShareImport`는 미리보기 표시용이다.

/** 이름이 같은 핀을 같은 장소로 보는 직선거리(m). */
export const SHARE_MATCH_RADIUS_M = 50;

const DEFAULT_TITLE_LABEL = '받은 장소';
const CUT_MARK = '…';
const MEMO_MAX = LIBRARY_LIMITS.memoChars;

type Outcome = keyof OpSummary;
type Failure = Extract<OpResult, { ok: false }>;

const fail = (error: OpError): Failure => ({ ok: false, error });

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;

/** 앞 `length`개 코드 단위. 자르는 곳이 서로게이트 쌍의 가운데면 한 단위 앞에서 자른다. */
function cutUnits(text: string, length: number): string {
  if (text.length <= length) return text;
  if (length <= 0) return '';
  return text.slice(0, isHighSurrogate(text.charCodeAt(length - 1)) ? length - 1 : length);
}

/** 앞뒤 공백을 지우고 30자(UTF-16)로 자른다. */
export function cutLabelName(name: string): string {
  return cutUnits(name.trim(), LIBRARY_LIMITS.labelNameChars);
}

/** 제목 라벨 입력의 기본값. 제목이 비면 `받은 장소`. */
export function defaultTitleLabel(title: string): string {
  return cutLabelName(title) || DEFAULT_TITLE_LABEL;
}

/** 새로 넣는 장소의 받은 메모. 10,000자를 넘으면 잘라 `…`로 끝낸다. */
function cutMemo(memo: string): string {
  return memo.length <= MEMO_MAX ? memo : cutUnits(memo, MEMO_MAX - CUT_MARK.length) + CUT_MARK;
}

/** 받은 장소의 출처. `naverSid` → `kakaoId` → `googleId` 중 형식이 맞는 첫 것, 없으면 핀. */
export function shareSource(place: SharePlace): PlaceSource {
  const candidates: PlaceSource[] = [];
  if (place.naverSid !== undefined) candidates.push({ kind: 'naver', sid: place.naverSid });
  if (place.kakaoId !== undefined) candidates.push({ kind: 'kakao', kakaoId: place.kakaoId });
  if (place.googleId !== undefined) candidates.push({ kind: 'google', googleId: place.googleId });
  return candidates.find((source) => is(PlaceSource, source)) ?? { kind: 'pin' };
}

/**
 * 이미 있는 장소의 메모 뒤에 받은 메모 블록을 덧붙인다(스펙 §3.4).
 * 받은 메모 원문이 지금 메모 어디에든 있으면 그대로 둔다. 10,000자를 넘으면 받은 메모를 잘라 `…`로 끝내고,
 * 머리 줄과 `…`조차 들어가지 않으면 그대로 둔다.
 */
export function appendReceivedMemo(current: string, title: string, memo: string): string {
  if (memo === '' || current.includes(memo)) return current;
  const prefix = `${current}${current === '' ? '' : '\n\n'}— 받은 메모 (${title}):\n`;
  if (prefix.length + memo.length <= MEMO_MAX) return prefix + memo;
  if (prefix.length + CUT_MARK.length > MEMO_MAX) return current;
  return prefix + cutUnits(memo, MEMO_MAX - prefix.length - CUT_MARK.length) + CUT_MARK;
}

// ---------- 같은 장소 찾기 ----------

type Candidate = { place: Place; dist: number };

/** 앞쪽이 더 맞는 후보인가: 살아 있는 것 > 가까운 것 > 늦게 지운 것. */
function better(a: Candidate, b: Candidate): boolean {
  const aLive = a.place.deletedAt === null;
  if (aLive !== (b.place.deletedAt === null)) return aLive;
  if (a.dist !== b.dist) return a.dist < b.dist;
  return (a.place.deletedAt ?? '') > (b.place.deletedAt ?? '');
}

/** 작업 중인 문서의 장소 색인(스펙 §3.1). `put`한 결과 장소는 다음 찾기에 바로 반영된다. */
type PlaceFinder = {
  places: Record<string, Place>;
  find: (item: SharePlace, source: PlaceSource) => Place | undefined;
  put: (place: Place) => void;
};

function placeFinder(lib: Library): PlaceFinder {
  const places: Record<string, Place> = { ...lib.places };
  const bySource = new Map<string, string>();
  for (const [key, place] of indexBySource(lib)) bySource.set(key, place.id);
  const byName = new Map<string, string[]>();
  const addName = (place: Place) => {
    const key = normalizeLabelName(place.name.value);
    byName.set(key, [...(byName.get(key) ?? []), place.id]);
  };
  Object.values(places).forEach(addName);

  const holderOf = (key: string): Place | undefined => {
    const id = bySource.get(key);
    return id === undefined ? undefined : places[id];
  };
  // 이름으로 찾은 지운 장소를 되살리면 같은 출처의 살아 있는 장소와 겹치는가(보관함 불변식).
  const blocked = (place: Place): boolean => {
    const key = sourceKey(place.source);
    if (place.deletedAt === null || key === null) return false;
    const holder = holderOf(key);
    return holder !== undefined && holder.id !== place.id && holder.deletedAt === null;
  };
  const byPosition = (item: SharePlace): Place | undefined => {
    let best: Candidate | undefined;
    for (const id of byName.get(normalizeLabelName(item.name)) ?? []) {
      const place = places[id]!;
      const dist = haversineM([place.lng, place.lat], [item.lng, item.lat]);
      if (dist > SHARE_MATCH_RADIUS_M || blocked(place)) continue;
      const candidate = { place, dist };
      if (best === undefined || better(candidate, best)) best = candidate;
    }
    return best?.place;
  };

  return {
    places,
    find: (item, source) => {
      const key = sourceKey(source);
      return key === null ? byPosition(item) : holderOf(key);
    },
    put: (place) => {
      if (!Object.hasOwn(places, place.id)) addName(place);
      places[place.id] = place;
      const key = sourceKey(place.source);
      if (key !== null) bySource.set(key, place.id);
    },
  };
}

// ---------- 라벨 ----------

function findLiveLabel(lib: Library, name: string): Label | undefined {
  const wanted = normalizeLabelName(name);
  return liveLabels(lib).find((l) => normalizeLabelName(l.name.value) === wanted);
}

/** 고른 장소가 쓰는 받은 라벨. 파일의 `order` 순이고, 다듬은 이름이 빈 것은 뺀다. */
function usedLabels(
  doc: ShareDoc,
  selected: ReadonlySet<string>,
): { label: ShareLabel; name: string }[] {
  const used = new Set(doc.places.filter((p) => selected.has(p.id)).flatMap((p) => p.labelIds));
  const seen = new Set<string>();
  return [...doc.labels]
    .sort((a, b) => a.order - b.order)
    .flatMap((label) => {
      const name = cutLabelName(label.name);
      if (!used.has(label.id) || name === '' || seen.has(label.id)) return [];
      seen.add(label.id);
      return [{ label, name }];
    });
}

/** 정규형이 같은 살아 있는 라벨을 쓰고(색·순서 그대로), 없으면 `color`로 맨 뒤에 만든다. */
function resolveLabel(
  lib: Library,
  name: string,
  color: LabelColor,
  ctx: OpCtx,
): { ok: true; lib: Library; labelId: string } | Failure {
  const reused = findLiveLabel(lib, name);
  if (reused !== undefined) return { ok: true, lib, labelId: reused.id };
  const created = createLabel(lib, name, ctx);
  if (!created.ok) return created;
  const id = created.createdId!;
  const made = created.lib.labels[id]!;
  const labels = {
    ...created.lib.labels,
    [id]: { ...made, color: { value: color, updatedAt: ctx.now } },
  };
  return { ok: true, lib: { ...created.lib, labels }, labelId: id };
}

type ResolvedLabels = { lib: Library; titleId: string | undefined; byShareId: Map<string, string> };

/** 제목 라벨을 먼저(새 색은 입력 문서의 `nextLabelColor`), 그다음 받은 라벨을 정한다(스펙 §3.3). */
function resolveLabels(
  lib: Library,
  doc: ShareDoc,
  selected: ReadonlySet<string>,
  titleLabel: string | null,
  ctx: OpCtx,
): ({ ok: true } & ResolvedLabels) | Failure {
  let work = lib;
  let titleId: string | undefined;
  if (titleLabel !== null) {
    const name = titleLabel.trim();
    if (name.length < 1 || name.length > LIBRARY_LIMITS.labelNameChars) {
      return fail({ _tag: 'LabelNameInvalid', name: titleLabel });
    }
    const r = resolveLabel(work, name, nextLabelColor(lib), ctx);
    if (!r.ok) return r;
    work = r.lib;
    titleId = r.labelId;
  }
  const byShareId = new Map<string, string>();
  for (const { label, name } of usedLabels(doc, selected)) {
    const r = resolveLabel(work, name, label.color, ctx);
    if (!r.ok) return r;
    work = r.lib;
    byShareId.set(label.id, r.labelId);
  }
  return { ok: true, lib: work, titleId, byShareId };
}

// ---------- 미리보기 ----------

export type ShareLabelPlan = {
  shareLabelId: string;
  name: string;
  color: LabelColor;
  reuse: boolean;
};
export type SharePlan = {
  /** 살아 있는 내 장소와 같은 받은 장소 id. */
  existing: ReadonlySet<string>;
  /** 고른 장소가 쓰는 받은 라벨. 파일의 `order` 순이고, 이름이 빈 것은 뺀다. */
  labels: ShareLabelPlan[];
  /** 제목 라벨 이름이 살아 있는 내 라벨과 같은가(`titleLabel`이 `null`이면 거짓). */
  titleReuse: boolean;
};

/** 미리보기의 `이미 있음`·`내 라벨에 합침` 표시용. 실제 처리는 `importShare`가 최신본으로 다시 판단한다. */
export function planShareImport(
  lib: Library,
  doc: ShareDoc,
  selected: readonly string[],
  titleLabel: string | null,
): SharePlan {
  const finder = placeFinder(lib);
  const existing = new Set(
    doc.places.filter((p) => finder.find(p, shareSource(p))?.deletedAt === null).map((p) => p.id),
  );
  const labels = usedLabels(doc, new Set(selected)).map(({ label, name }) => ({
    shareLabelId: label.id,
    name,
    color: label.color,
    reuse: findLiveLabel(lib, name) !== undefined,
  }));
  const titleReuse = titleLabel !== null && findLiveLabel(lib, titleLabel) !== undefined;
  return { existing, labels, titleReuse };
}

// ---------- 가져오기 ----------

export type ShareImportInput = {
  selected: readonly string[];
  titleLabel: string | null;
  appendMemo: boolean;
};

/** 받은 장소 하나의 결과 장소. 같은 장소가 있으면 합치고(지운 것은 되살린다) 없으면 새로 만든다. */
function placeItem(
  lib: Library,
  finder: PlaceFinder,
  item: SharePlace,
  labelIds: readonly string[],
  memo: { title: string; append: boolean },
  ctx: OpCtx,
): { place: Place; outcome: Outcome } {
  const source = shareSource(item);
  const existing = finder.find(item, source);
  const received = item.memo ?? '';
  if (existing === undefined) {
    const candidate: PlaceCandidate = { ...pick(item), source, category: null };
    const place = newPlace(ctx.newId('place'), candidate, labelIds, cutMemo(received), ctx.now);
    return { place, outcome: 'created' };
  }
  const append = memo.append
    ? (current: string) => appendReceivedMemo(current, memo.title, received)
    : '';
  return {
    place: mergeInto(lib, existing, labelIds, append, ctx.now),
    outcome: existing.deletedAt === null ? 'merged' : 'restored',
  };
}

const pick = ({ name, address, lng, lat }: SharePlace) => ({ name, address, lng, lat });

/**
 * 고른 받은 장소를 파일 순서대로 작업 중인 문서에 이어서 넣는다(스펙 §3).
 * `summary`는 결과 장소마다 처음 손댄 순간의 원래 상태로 한 번만 센다(스펙 §3.5).
 * `createdId`는 제목 라벨 id(없으면 `undefined`).
 */
export function importShare(
  lib: Library,
  doc: ShareDoc,
  input: ShareImportInput,
  ctx: OpCtx,
): OpResult {
  const selected = new Set(input.selected);
  const labels = resolveLabels(lib, doc, selected, input.titleLabel, ctx);
  if (!labels.ok) return labels;
  const base = labels.lib;
  const finder = placeFinder(base);
  const outcomes = new Map<string, Outcome>();
  const memo = { title: doc.title, append: input.appendMemo };
  for (const item of doc.places) {
    if (!selected.has(item.id)) continue;
    const received = item.labelIds.flatMap((id) => labels.byShareId.get(id) ?? []);
    const title = labels.titleId === undefined ? [] : [labels.titleId];
    const labelIds = [...new Set([...received, ...title])];
    const { place, outcome } = placeItem(base, finder, item, labelIds, memo, ctx);
    finder.put(place);
    if (!outcomes.has(place.id)) outcomes.set(place.id, outcome);
  }
  const summary: OpSummary = { created: 0, merged: 0, restored: 0 };
  for (const outcome of outcomes.values()) summary[outcome] += 1;
  return {
    ok: true,
    lib: { ...base, places: finder.places },
    createdId: labels.titleId,
    summary,
  };
}
