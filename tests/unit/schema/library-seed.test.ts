import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { regionOf } from 'src/domain/library/region';
import { LibrarySchema } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';

const seed: unknown = JSON.parse(readFileSync('tests/fixtures/library/seed.json', 'utf-8'));

/** E2E가 `localStorage`에 심는 보관함 시드가 앱이 받아들이는 형식인지 지킨다. */
describe('E2E 보관함 시드(tests/fixtures/library/seed.json)', () => {
  it('LibrarySchema를 통과한다', () => {
    const result = safeParse(LibrarySchema, seed);
    expect(result.success ? [] : result.issues).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('장소 30곳·라벨 6개에 강릉·속초·제주·서울 주소와 긴 이름·이모지 메모가 있다', () => {
    const result = safeParse(LibrarySchema, seed);
    if (!result.success) throw new Error('시드가 스키마를 통과하지 못했어요');
    const places = Object.values(result.data.places);
    expect(places).toHaveLength(30);
    expect(Object.keys(result.data.labels)).toHaveLength(6);
    expect(new Set(places.map((p) => regionOf(p.address)))).toEqual(
      new Set(['강릉', '속초', '제주', '서울']),
    );
    expect(places.some((p) => p.name.value.length >= 50)).toBe(true);
    expect(places.some((p) => /\p{Extended_Pictographic}/u.test(p.memo.value))).toBe(true);
    // 분류 없는 장소도 있다(미분류 필터 확인용).
    expect(places.some((p) => p.labelIds.value.length === 0)).toBe(true);
  });
});
