import { describe, expect, it } from 'vitest';
import {
  applyLabelEmojiSuggestions,
  labelEmojiSuggestions,
  revertLabelEmojis,
  setLabelEmoji,
} from 'src/domain/library/label-emoji-ops';
import { sampleLibrary, T0 } from '../../sections/library/fixtures';

const ctx = { now: '2026-10-23T01:00:00.000Z', newId: () => 'label099' };
const later = { ...ctx, now: '2026-10-23T02:00:00.000Z' };
const undoCtx = { ...ctx, now: '2026-10-23T03:00:00.000Z' };

describe('라벨 이모지 변경', () => {
  it('선택·지우기는 선택 필드 LWW이며 다른 필드를 유지한다', () => {
    const lib = sampleLibrary();
    expect(setLabelEmoji(lib, 'label002', null, ctx)).toBe(lib);
    expect(setLabelEmoji(lib, 'unknown1', '☕', ctx)).toBe(lib);
    expect(setLabelEmoji(lib, 'label002', '문자', ctx)).toBe(lib);
    const chosen = setLabelEmoji(lib, 'label002', '☕', ctx);
    expect(chosen.labels.label002!.emoji).toEqual({ value: '☕', updatedAt: ctx.now });
    expect(chosen.labels.label002!.icon).toBe(lib.labels.label002!.icon);
    expect(setLabelEmoji(chosen, 'label002', '☕', later)).toBe(chosen);
    expect(setLabelEmoji(chosen, 'label002', null, later).labels.label002!.emoji).toEqual({
      value: null,
      updatedAt: later.now,
    });
  });

  it('추천은 이모지 없음/null만 포함하며 삭제/추천 없음은 뺀다', () => {
    const lib = sampleLibrary();
    const updated = {
      ...lib,
      labels: {
        ...lib.labels,
        label001: { ...lib.labels.label001!, emoji: { value: '⭐', updatedAt: T0 } },
        label002: { ...lib.labels.label002!, emoji: { value: null, updatedAt: T0 } },
        label003: { ...lib.labels.label003!, name: { value: '센픽', updatedAt: T0 } },
      },
    };
    expect(labelEmojiSuggestions(updated).map((s) => [s.labelId, s.suggested])).toEqual([
      ['label002', '☕'],
    ]);
    expect(
      labelEmojiSuggestions({
        ...updated,
        labels: { ...updated.labels, label002: { ...updated.labels.label002, deletedAt: T0 } },
      }),
    ).toEqual([]);
  });

  it('체크한 추천만 적용하고 원래 없음은 새 null 묘비로 되돌린다', () => {
    const lib = sampleLibrary();
    const suggestions = labelEmojiSuggestions(lib).filter((s) => s.labelId !== 'label003');
    const out = applyLabelEmojiSuggestions(lib, suggestions, ctx);
    expect(out.changes).toHaveLength(2);
    expect(out.skipped).toBe(0);
    expect(out.lib.labels.label001!.emoji?.value).toBe('🍽️');
    expect(out.lib.labels.label002!.emoji?.value).toBe('☕');
    expect(out.lib.labels.label003!.emoji).toBeUndefined();
    const reverted = revertLabelEmojis(out.lib, out.changes, undoCtx);
    expect(reverted.ok).toBe(true);
    if (!reverted.ok) return;
    expect(reverted.lib.labels.label001!.emoji).toEqual({ value: null, updatedAt: undoCtx.now });
    expect(reverted.lib.labels.label002!.emoji).toEqual({ value: null, updatedAt: undoCtx.now });
  });

  it('미리보기 후 이름/이모지 변경·삭제·없는 라벨을 건너뛴다', () => {
    const lib = sampleLibrary();
    const suggestions = labelEmojiSuggestions(lib);
    const changed = setLabelEmoji(lib, 'label001', '❤️', later);
    const latest = {
      ...changed,
      labels: {
        ...changed.labels,
        label002: { ...changed.labels.label002!, name: { value: '빵', updatedAt: later.now } },
        label003: { ...changed.labels.label003!, deletedAt: later.now },
      },
    };
    const out = applyLabelEmojiSuggestions(
      latest,
      [...suggestions, { ...suggestions[0]!, labelId: 'unknown1' }],
      ctx,
    );
    expect(out.changes).toEqual([]);
    expect(out.skipped).toBe(4);
    expect(out.lib).toBe(latest);
  });

  it('되돌리기는 이후 변경한 필드를 덮어쓰지 않고 이름/색 변경은 유지한다', () => {
    const lib = sampleLibrary();
    const out = applyLabelEmojiSuggestions(lib, labelEmojiSuggestions(lib), ctx);
    const edited = setLabelEmoji(out.lib, 'label001', '❤️', later);
    const latest = {
      ...edited,
      labels: {
        ...edited.labels,
        label002: {
          ...edited.labels.label002!,
          color: { value: 'purple' as const, updatedAt: later.now },
        },
        label003: { ...edited.labels.label003!, deletedAt: later.now },
      },
    };
    const reverted = revertLabelEmojis(latest, out.changes, undoCtx);
    expect(reverted.ok).toBe(true);
    if (!reverted.ok) return;
    expect(reverted.summary?.merged).toBe(2);
    expect(reverted.lib.labels.label001!.emoji?.value).toBe('❤️');
    expect(reverted.lib.labels.label002!.emoji?.value).toBeNull();
    expect(reverted.lib.labels.label002!.color.value).toBe('purple');
    expect(reverted.lib.labels.label003).toBe(latest.labels.label003);
  });

  it('같은 시각이어도 값이 다른 필드는 되돌리지 않는다', () => {
    const lib = sampleLibrary();
    const out = applyLabelEmojiSuggestions(lib, labelEmojiSuggestions(lib), ctx);
    const latest = setLabelEmoji(out.lib, 'label001', '❤️', ctx);
    const reverted = revertLabelEmojis(latest, out.changes, undoCtx);
    if (!reverted.ok) throw new Error('되돌리기 실패');
    expect(reverted.summary?.merged).toBe(1);
    expect(reverted.lib.labels.label001!.emoji?.value).toBe('❤️');
  });
});
