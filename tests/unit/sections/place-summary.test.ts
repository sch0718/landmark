import { describe, expect, it } from 'vitest';
import { overlay } from 'src/domain/overlay';
import { categoryEmoji, summarizePlace } from 'src/sections/explore/store/place-summary';
import { makeEdit, makeTrip } from '../../fixtures/builders';

const NOW = '2026-10-03T00:00:00.000Z';
const memo = (text: string | null) => ({ text, updatedAt: NOW });

describe('place summary', () => {
  it('삭제 메모를 제외하고 본인 미리보기와 중복 없는 실제 일정 날짜를 표시한다', () => {
    const trip = makeTrip({ days: { '2026-11-14': ['A', 'A2'], '2026-11-15': ['A3'] } });
    trip.places['n:1']!.naverMemos = [{ folderId: 'f1', memo: '네이버 메모' }];
    const edit = makeEdit({
      places: {
        'n:1': {
          memos: {
            other: memo('동행 메모'),
            gone: memo(null),
            'a-local': memo(' 내\n 메모 '),
          },
          hidden: { value: true, updatedAt: NOW },
        },
      },
    });
    expect(summarizePlace(trip, edit, overlay(trip, edit), 'n:1')).toEqual({
      placeKey: 'n:1',
      name: 'A',
      category: '음식점',
      emoji: '🍽️',
      memoCount: 3,
      memoPreview: '내 메모',
      dayLabels: ['Day 1', 'Day 2'],
      hidden: true,
    });
  });
  it('편집 레이어의 분류로 분류와 이모지를 정한다', () => {
    const trip = makeTrip({ days: {}, places: ['A'] });
    const edit = makeEdit({
      places: { 'n:1': { memos: {}, category: { value: '호텔', updatedAt: NOW } } },
    });
    expect(summarizePlace(trip, edit, overlay(trip, edit), 'n:1')).toMatchObject({
      category: '호텔',
      emoji: '🏨',
    });
  });
  it('실효 일정과 작성자 정렬을 사용하고 빈 메모는 미리보기에서 제외한다', () => {
    const trip = makeTrip({ days: { '2026-11-14': ['A'] } });
    const edit = makeEdit({
      places: { 'n:1': { memos: { z: memo('마지막'), b: memo('  '), a: memo('첫 메모') } } },
      days: { '2026-11-14': { mode: 'override', stops: [], baseDayHash: 'test', updatedAt: NOW } },
    });
    const summary = summarizePlace(trip, edit, overlay(trip, edit), 'n:1');
    expect(summary?.memoPreview).toBe('첫 메모');
    expect(summary?.dayLabels).toEqual([]);
  });
  it('편집이 없으면 네이버 미리보기와 기본값을 표시한다', () => {
    const trip = makeTrip({ days: {}, places: ['A'] });
    trip.places['n:1']!.category = null;
    trip.places['n:1']!.naverMemos = [{ folderId: 'f1', memo: '원본 메모' }];
    expect(summarizePlace(trip, null, overlay(trip, null), 'n:1')).toMatchObject({
      category: '미분류',
      emoji: '📍',
      memoCount: 1,
      memoPreview: '원본 메모',
      hidden: false,
    });
  });
  it.each(['n:missing', 'toString', 'constructor', '__proto__'])(
    '없는 장소 %s는 반환하지 않는다',
    (key) => {
      const trip = makeTrip({ days: {} });
      expect(summarizePlace(trip, null, overlay(trip, null), key)).toBeNull();
    },
  );
  it.each([
    ['카페', '☕'],
    ['호텔', '🏨'],
    ['식당', '🍽️'],
    ['해변', '🌊'],
    ['공원', '🌿'],
    [null, '📍'],
  ])('카테고리 %s를 이모지로 표시한다', (category, emoji) =>
    expect(categoryEmoji(category)).toBe(emoji),
  );
});
