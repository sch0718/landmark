import { createLabel } from 'src/domain/library/label-create';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { suggestLabelEmoji } from 'src/domain/library/label-emoji';
import { mergeLabels, reorderLabels } from 'src/domain/library/ops';
import { emptyLibrary, LabelSchema, LibrarySchema } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { makeLabel, sampleLibrary, T0 } from '../../sections/library/fixtures';

const ctx = { now: '2026-10-23T01:00:00.000Z', newId: () => 'label099' };
const base = makeLabel('label001', '카페', 'red', 'star', 0);

describe('라벨 이모지 스키마', () => {
  it.each(['☕', '🍽️', '👨‍🍳', '👨🏽‍🍳', '👨‍👩‍👧‍👦', null])('%s를 보존한다', (value) => {
    const input = { ...base, emoji: { value, updatedAt: T0 } };
    const result = safeParse(LabelSchema, input);
    expect(result.success).toBe(true);
    if (result.success) expect(Schema.encodeSync(LabelSchema)(result.data)).toEqual(input);
  });

  it.each([
    '',
    '커피',
    '1',
    '☕🥐',
    ' ☕',
    '☕ ',
    'a☕',
    '🇰🇷',
    '1️⃣',
    '☕' + '\uFE0F'.repeat(16),
    1,
    {},
  ])('잘못된 값 %s를 거부한다', (value) => {
    expect(safeParse(LabelSchema, { ...base, emoji: { value, updatedAt: T0 } }).success).toBe(
      false,
    );
  });

  it('옛 문서는 키를 더하지 않고 그대로 읽는다', () => {
    const lib = sampleLibrary();
    expect(safeParse(LibrarySchema, lib)).toEqual({ success: true, data: lib });
    expect(safeParse(LabelSchema, base)).toEqual({ success: true, data: base });
  });

  it('옛 스키마는 새 필드를 떼어 내고 읽는다', () => {
    const fields = LabelSchema.fields;
    const old = Schema.Struct({
      id: fields.id,
      name: fields.name,
      color: fields.color,
      icon: fields.icon,
      order: fields.order,
      createdAt: fields.createdAt,
      deletedAt: fields.deletedAt,
    });
    const result = safeParse(old, { ...base, emoji: { value: '☕', updatedAt: T0 } });
    expect(result).toEqual({ success: true, data: base });
  });
});

export const USER_LABEL_EMOJIS: [string, string | null][] = [
  ['서울 카페&베이커리', '☕'],
  ['서울 맛집', '🍽️'],
  ['강원도 명소', '📸'],
  ['저장 많은 국밥집 100선⭐', '🍲'],
  ['저장 많은 숙성회 파는 집 50선⭐️', '🐟'],
  ['저장 많은 평양냉면집 50선⭐', '🍜'],
  ['대전 빵투어(2.3)', '🥐'],
  ['저장 많은 수제버거 100선⭐', '🍔'],
  ['저장 많은 떡볶이집 100선⭐', '🌶️'],
  ['저장 많은 곱창집 100선⭐', '🥩'],
  ['저장 많은 삼겹살집 100선⭐', '🥩'],
  ['저장 많은 돼지갈비집 100선⭐', '🥩'],
  ['저장 많은 돈가스집 100선⭐', '🍖'],
  ['저장 많은 김밥집 100선⭐', '🍙'],
  ['저장 많은 기사식당 100선⭐', '🚕'],
  ['[흑백요리사]출연 셰프 식당 리스트', '👨‍🍳'],
  ['신세계 정용진이 모은 맛집-강원', '🍽️'],
  ['저장 많은 TV 맛집 서울 100선⭐', '🍽️'],
  ['강원도 동해안 뷰 맛집', '🌊'],
  ['서울 근교 명소', '📸'],
  ['군산 아영이랑', null],
  ['센픽', null],
];

describe('이름으로 이모지 추천', () => {
  it.each(USER_LABEL_EMOJIS)('%s → %s', (name, expected) => {
    expect(suggestLabelEmoji(name)).toBe(expected);
  });
  it.each([
    ['디저트', '🍰'],
    ['맥주', '🍺'],
    ['와인', '🍷'],
    ['등산', '⛰️'],
    ['공원', '🌳'],
    ['숙소', '🏨'],
    ['쇼핑', '🛍️'],
    ['시장', '🧺'],
    ['문화', '🎨'],
    ['축제', '🎉'],
    ['드라이브', '🚗'],
    ['캠핑', '⛺'],
    ['온천', '♨️'],
    ['반려동물', '🐶'],
    ['아이', '🧸'],
    ['피자 맛집', '🍕'],
    ['치킨 식당', '🍗'],
    ['초밥 맛집', '🍣'],
    ['샐러드', '🥗'],
    ['기차', '🚆'],
    ['자전거', '🚲'],
    ['책방', '📚'],
    ['데이트', '❤️'],
    ['회', '🐟'],
    ['서울 회 맛집', '🐟'],
    ['회사 회의', null],
    ['100회 방문', null],
    ['cafe회', null],
    ['산', null],
    ['⭐', null],
  ])('%s → %s', (name, expected) => {
    expect(suggestLabelEmoji(name)).toBe(expected);
  });
});

describe('새 라벨과 다른 연산', () => {
  it.each([
    ['카페', '☕'],
    ['센픽', undefined],
  ])('새 %s 라벨의 처음 값', (name, expected) => {
    const result = createLabel(emptyLibrary(), name!, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lib.labels.label099!.emoji?.value).toBe(expected);
    expect(result.lib.labels.label099!.icon.value).toBe('star');
    if (expected) expect(result.lib.labels.label099!.emoji?.updatedAt).toBe(ctx.now);
    expect(safeParse(LibrarySchema, result.lib).success).toBe(true);
  });

  it('정렬과 병합은 남는 라벨 이모지를 유지한다', () => {
    const sample = sampleLibrary();
    const label = { ...sample.labels.label002!, emoji: { value: '☕', updatedAt: T0 } };
    const lib = { ...sample, labels: { ...sample.labels, [label.id]: label } };
    const reordered = reorderLabels(lib, ['label002', 'label001', 'label003'], ctx);
    expect(reordered.labels.label002!.emoji).toBe(label.emoji);
    const merged = mergeLabels(reordered, 'label001', 'label002', ctx);
    expect(merged.labels.label002!.emoji).toBe(label.emoji);
  });
});

it('백업을 읽어 복원할 보관함에도 이모지가 남는다', async () => {
  const { buildBackupText } = await import('src/domain/backup/build-backup');
  const { readBackupText } = await import('src/domain/backup/read-backup');
  const original = sampleLibrary();
  const lib = {
    ...original,
    labels: {
      ...original.labels,
      label002: { ...original.labels.label002!, emoji: { value: '👨🏽‍🍳', updatedAt: T0 } },
    },
  };
  const restored = readBackupText(
    buildBackupText({ rawLibrary: lib, prefs: null, now: new Date(ctx.now) }),
  );
  expect(restored.ok).toBe(true);
  if (!restored.ok) return;
  expect(restored.backup.droppedUnknown).toBe(false);
  expect(restored.backup.library).toEqual(lib);
});

it('네이버 폴더 가져오기에서도 새 라벨의 추천을 유지한다', async () => {
  const { importFolder } = await import('src/domain/library/add-place');
  const result = importFolder(emptyLibrary(), [], { newLabelName: '대전 빵투어(2.3)' }, ctx);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.lib.labels[result.createdId!]!.emoji?.value).toBe('🥐');
    expect(result.lib.labels[result.createdId!]!.icon.value).toBe('star');
  }
});
