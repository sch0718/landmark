import { suggestLabelEmoji } from 'src/domain/library/label-emoji';
import { setOptionalField, type Field } from 'src/domain/library/lww';
import type { OpCtx, OpResult } from 'src/domain/library/ops';
import { liveLabels } from 'src/domain/library/query';
import { LabelEmoji, type Label, type Library } from 'src/schema/library';
import { is } from 'src/schema/parse';

export type EmojiSuggestion = {
  labelId: string;
  nameBefore: Field<string>;
  emojiBefore: Field<string | null> | undefined;
  suggested: string;
};
export type EmojiChange = {
  labelId: string;
  before: Field<string | null> | undefined;
  after: Field<string | null>;
};

const sameField = <T>(a: Field<T> | undefined, b: Field<T> | undefined): boolean =>
  a === b ||
  (a !== undefined && b !== undefined && a.updatedAt === b.updatedAt && a.value === b.value);

function withLabels(lib: Library, changed: Record<string, Label>): Library {
  return Object.keys(changed).length === 0
    ? lib
    : { ...lib, labels: { ...lib.labels, ...changed } };
}

/** 선택 필드를 처음 비울 때는 키를 만들지 않고, 있던 이모지를 지울 때는 null 묘비를 쓴다. */
export function setLabelEmoji(lib: Library, id: string, value: string | null, ctx: OpCtx): Library {
  const label = lib.labels[id];
  if (label === undefined || label.deletedAt !== null || (value !== null && !is(LabelEmoji, value)))
    return lib;
  const emoji = setOptionalField(label.emoji, value, null, ctx.now);
  return emoji === label.emoji ? lib : withLabels(lib, { [id]: { ...label, emoji } });
}

/** 미리보기 시점의 필드도 함께 담아 저장 직전 다른 편집을 알아챈다. */
export function labelEmojiSuggestions(lib: Library): EmojiSuggestion[] {
  return liveLabels(lib).flatMap((label) => {
    if (label.emoji?.value != null) return [];
    const suggested = suggestLabelEmoji(label.name.value);
    return suggested === null
      ? []
      : [
          {
            labelId: label.id,
            nameBefore: label.name,
            emojiBefore: label.emoji,
            suggested,
          },
        ];
  });
}

/** 최신본에서 그대로인 라벨만 적용한다. 변경 기록은 저장소 잠금 안에서 만든다. */
export function applyLabelEmojiSuggestions(
  lib: Library,
  suggestions: readonly EmojiSuggestion[],
  ctx: OpCtx,
): { lib: Library; changes: EmojiChange[]; skipped: number } {
  const changed: Record<string, Label> = {};
  const changes: EmojiChange[] = [];
  let skipped = 0;
  for (const suggestion of suggestions) {
    const label = lib.labels[suggestion.labelId];
    if (changed[suggestion.labelId] !== undefined) continue;
    if (
      label === undefined ||
      label.deletedAt !== null ||
      label.emoji?.value != null ||
      !sameField(label.name, suggestion.nameBefore) ||
      !sameField(label.emoji, suggestion.emojiBefore) ||
      !is(LabelEmoji, suggestion.suggested)
    ) {
      skipped++;
      continue;
    }
    const after = { value: suggestion.suggested, updatedAt: ctx.now };
    changed[label.id] = { ...label, emoji: after };
    changes.push({ labelId: label.id, before: label.emoji, after });
  }
  return { lib: withLabels(lib, changed), changes, skipped };
}

/** 이후 값·시각이 모두 같은 필드만 되돌린다. 없던 키는 새 null 묘비로 복원한다. */
export function revertLabelEmojis(
  lib: Library,
  changes: readonly EmojiChange[],
  ctx: OpCtx,
): OpResult {
  const changed: Record<string, Label> = {};
  let skipped = 0;
  for (const change of changes) {
    const label = lib.labels[change.labelId];
    if (label === undefined || label.deletedAt !== null || !sameField(label.emoji, change.after)) {
      skipped++;
      continue;
    }
    changed[label.id] = {
      ...label,
      emoji: { value: change.before?.value ?? null, updatedAt: ctx.now },
    };
  }
  return {
    ok: true,
    lib: withLabels(lib, changed),
    summary: { created: 0, merged: skipped, restored: 0 },
  };
}
