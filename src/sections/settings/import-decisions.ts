import { legacyLabelSources, type ImportChoices } from 'src/domain/library/legacy-import';
import type { LegacySource, MemoDecision, PendingDecision } from 'src/domain/library/legacy-import';
import { liveLabels } from 'src/domain/library/query';
import { LIBRARY_LIMITS, normalizeLabelName, type Library } from 'src/schema/library';

/** 라벨 이름 확인 항목 하나의 입력. `confirmed`가 아니면 아직 결정이 아니다(제안값을 조용히 받지 않는다). */
export type LabelDraft = { name: string; excluded: boolean; confirmed: boolean };

export type Decisions = {
  labels: Record<string, LabelDraft>;
  memos: Record<string, MemoDecision>;
};

export const NO_DECISIONS: Decisions = { labels: {}, memos: {} };

export const NAME_LENGTH_MESSAGE = `1–${LIBRARY_LIMITS.labelNameChars}자로 입력하세요`;
export const NAME_TAKEN_MESSAGE = '같은 이름의 라벨이 있어요';

/** 확인 대상으로 나왔던 항목. 결정한 뒤에도 고칠 수 있게 계속 보여 준다. */
export type LabelItem = {
  kind: 'label-name';
  key: string;
  rawName: string;
  suggested: string;
  reason: 'empty' | 'too-long';
};
export type MemoItem = {
  kind: 'memo-too-long';
  placeKey: string;
  placeName: string;
  length: number;
};
export type Items = { labels: LabelItem[]; memos: MemoItem[] };

export const NO_ITEMS: Items = { labels: [], memos: [] };

/** 새로 나온 확인 대상을 항목에 더하고, 라벨 이름의 초안(제안값)을 만든다. */
export function mergePending(
  items: Items,
  decisions: Decisions,
  pending: readonly PendingDecision[],
  source: LegacySource,
): { items: Items; decisions: Decisions } {
  const rawNames = new Map(legacyLabelSources(source).map((s) => [s.key, s.rawName]));
  const labels = [...items.labels];
  const memos = [...items.memos];
  const drafts = { ...decisions.labels };
  for (const p of pending) {
    if (p.kind === 'label-name') {
      if (labels.some((l) => l.key === p.key)) continue;
      labels.push({
        kind: 'label-name',
        key: p.key,
        rawName: rawNames.get(p.key) ?? p.key,
        suggested: p.suggested,
        reason: p.reason,
      });
      drafts[p.key] = { name: p.suggested, excluded: false, confirmed: false };
    } else if (!memos.some((m) => m.placeKey === p.placeKey)) {
      memos.push(p);
    }
  }
  return { items: { labels, memos }, decisions: { ...decisions, labels: drafts } };
}

const lengthOk = (name: string): boolean =>
  name !== '' && name.length <= LIBRARY_LIMITS.labelNameChars;

/**
 * 고른 라벨 이름의 오류 문구(없으면 `null`). 비었거나 30자 초과이거나, 보관함의 살아 있는 라벨 또는
 * 가져올 다른 라벨과 정규화한 이름이 같으면 오류다(도메인은 같은 이름을 조용히 재사용하므로 화면이 막는다).
 */
export function labelNameError(
  key: string,
  decisions: Decisions,
  library: Library,
  source: LegacySource,
): string | null {
  const draft = decisions.labels[key];
  if (draft === undefined || draft.excluded) return null;
  const name = draft.name.trim();
  if (!lengthOk(name)) return NAME_LENGTH_MESSAGE;
  const normalized = normalizeLabelName(name);
  if (liveLabels(library).some((l) => normalizeLabelName(l.name.value) === normalized)) {
    return NAME_TAKEN_MESSAGE;
  }
  for (const other of legacyLabelSources(source)) {
    if (other.key === key) continue;
    const otherDraft = decisions.labels[other.key];
    if (otherDraft?.excluded === true) continue;
    const otherName = (otherDraft?.name ?? other.rawName).trim();
    if (lengthOk(otherName) && normalizeLabelName(otherName) === normalized) {
      return NAME_TAKEN_MESSAGE;
    }
  }
  return null;
}

/** 결정에서 도메인에 넘길 선택을 만든다. 확인하지 않았거나 오류가 있는 이름은 넣지 않아 계속 확인 대상으로 남는다. */
export function toChoices(
  decisions: Decisions,
  library: Library,
  source: LegacySource,
): ImportChoices {
  const labels: ImportChoices['labels'] = {};
  for (const [key, draft] of Object.entries(decisions.labels)) {
    if (!draft.confirmed) continue;
    if (draft.excluded) labels[key] = { kind: 'exclude' };
    else if (labelNameError(key, decisions, library, source) === null) {
      labels[key] = { kind: 'use', name: draft.name };
    }
  }
  return { labels, memos: { ...decisions.memos } };
}
