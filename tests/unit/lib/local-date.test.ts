import { describe, expect, it } from 'vitest';
import { localDate } from 'src/lib/local-date';

describe('localDate', () => {
  it('기기 시간대의 날짜를 YYYY.MM.DD로 낸다', () => {
    // TZ에 기대지 않도록 로컬 시각에서 ISO를 만든다.
    expect(localDate(new Date(2026, 9, 3, 23, 30).toISOString())).toBe('2026.10.03');
    expect(localDate(new Date(2026, 0, 1, 0, 5).toISOString())).toBe('2026.01.01');
  });
});
