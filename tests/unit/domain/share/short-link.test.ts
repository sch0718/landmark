import { describe, expect, it } from 'vitest';
import {
  formatShortExpiry,
  shortExpiresAt,
  shortKeepUntil,
  SHORT_LINK_DAYS,
} from 'src/domain/share/short-link';
import { shortMetaOf } from 'src/sections/share-export/use-short-link';
import type { ShareDoc } from 'src/schema/share';

const NOW = new Date('2026-10-28T03:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

describe('짧은 링크 보관 기한', () => {
  it('장소 30일·일정 여행 끝 + 7일(30~180일)', () => {
    expect(SHORT_LINK_DAYS).toEqual({ min: 30, max: 180, afterTrip: 7 });
  });

  it('일정의 기준일은 가장 늦은 끝날 + 7일이고, 날짜가 없으면 null', () => {
    expect(shortKeepUntil(['2026-12-01', '2027-01-03', '2026-11-10'])).toBe('2027-01-10');
    expect(shortKeepUntil(['2026-12-28'])).toBe('2027-01-04');
    expect(shortKeepUntil([])).toBeNull();
    expect(shortKeepUntil(['날짜 아님'])).toBeNull();
  });

  it.each([
    ['장소', 'places', '2027-06-01', NOW.getTime() + 30 * DAY],
    ['기준일 없는 일정', 'trip', null, NOW.getTime() + 30 * DAY],
    ['곧 끝나는 일정', 'trip', '2026-11-04', NOW.getTime() + 30 * DAY],
    ['먼 일정', 'trip', '2027-01-10', new Date('2027-01-10T14:59:59.999Z').getTime()],
    ['아주 먼 일정', 'trip', '2028-01-01', NOW.getTime() + 180 * DAY],
    ['모양이 틀린 기준일', 'trip', '2027-1-10', NOW.getTime() + 30 * DAY],
  ] as const)('%s', (_name, kind, keepUntil, expected) => {
    expect(shortExpiresAt(kind, keepUntil, NOW).getTime()).toBe(expected);
  });

  it('기한은 한국 날짜로 보이고 해가 바뀌면 연도를 붙인다', () => {
    expect(formatShortExpiry(new Date('2026-11-27T03:00:00Z'), NOW)).toBe('11월 27일');
    expect(formatShortExpiry(new Date('2026-12-31T16:00:00Z'), NOW)).toBe('2027년 1월 1일');
  });
});

describe('shortMetaOf', () => {
  const base = {
    format: 'tripmap-share',
    title: '시험',
    createdAt: NOW.toISOString(),
    labels: [],
    places: [],
  } as const;
  it('장소 문서는 places, 일정 문서는 trip과 기준일', () => {
    expect(shortMetaOf({ ...base, version: 1 } as unknown as ShareDoc)).toEqual({
      kind: 'places',
      keepUntil: null,
    });
    const trip = { startDate: '2026-12-01', endDate: '2026-12-03' };
    expect(shortMetaOf({ ...base, version: 2, trips: [trip] } as unknown as ShareDoc)).toEqual({
      kind: 'trip',
      keepUntil: '2026-12-10',
    });
  });
});
