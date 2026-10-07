import { describe, expect, it } from 'vitest';
import { applyCategoryEdits, effectiveCategory } from 'src/domain/place-category';
import { makeEdit, makeTrip } from '../../fixtures/builders';

const NOW = '2026-10-03T00:00:00.000Z';
const categoryOf = (value: string | null) => ({ memos: {}, category: { value, updatedAt: NOW } });

describe('effectiveCategory', () => {
  const place = makeTrip({ days: {}, places: ['A'] }).places['n:1']!;

  it('편집이 없으면 원본 분류', () => {
    expect(effectiveCategory(place, undefined)).toBe('음식점');
    expect(effectiveCategory(place, { memos: {} })).toBe('음식점');
  });

  it('문자열이면 덮어쓴다', () => {
    expect(effectiveCategory(place, categoryOf('숙소'))).toBe('숙소');
    expect(effectiveCategory({ ...place, category: null }, categoryOf('공항'))).toBe('공항');
  });

  it('value null이면 원본 분류(미분류 포함)', () => {
    expect(effectiveCategory(place, categoryOf(null))).toBe('음식점');
    expect(effectiveCategory({ ...place, category: null }, categoryOf(null))).toBeNull();
  });
});

describe('applyCategoryEdits', () => {
  it('편집을 적용한 places를 돌려주고 입력은 바꾸지 않는다', () => {
    const trip = makeTrip({ days: {}, places: ['A', 'B', 'C'] });
    trip.places['n:3']!.category = null;
    const edit = makeEdit({
      places: { 'n:1': categoryOf('숙소'), 'n:2': categoryOf(null), 'n:3': categoryOf('공항') },
    });
    const tripCopy = structuredClone(trip);
    const editCopy = structuredClone(edit);
    const places = applyCategoryEdits(trip, edit);
    expect(places['n:1']!.category).toBe('숙소');
    expect(places['n:2']!.category).toBe('음식점');
    expect(places['n:3']!.category).toBe('공항');
    expect(places['n:1']!.name).toBe('A');
    expect(trip).toEqual(tripCopy);
    expect(edit).toEqual(editCopy);
  });

  it('편집 레이어가 없으면 원본 places와 같은 값', () => {
    const trip = makeTrip({ days: {}, places: ['A'] });
    expect(applyCategoryEdits(trip, null)).toEqual(trip.places);
  });
});
