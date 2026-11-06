import { describe, expect, it } from 'vitest';
import { expiryLabel, fromLine, inboxLine, scopeLabel } from 'src/sections/agent/agent-copy';
import type { InboxItemView } from 'src/services/agent-inbox/api';

const now = new Date(2026, 10, 20, 16);
const item: InboxItemView = {
  id: 'inbox00000000001',
  title: '강릉 여행',
  startDate: '2026-11-20',
  endDate: '2026-11-21',
  places: 5,
  from: '여행 도우미',
  createdAt: new Date(2026, 10, 20, 15, 12).getTime(),
  expiresAt: new Date(2026, 11, 20).getTime(),
};

describe('받은함 문구', () => {
  it.each([
    ['2026-11-20', '2026-11-20', '11월 20일'],
    ['2026-11-20', '2026-11-21', '11월 20일~21일'],
    ['2026-11-30', '2026-12-02', '11월 30일~12월 2일'],
    ['2026-12-31', '2027-01-02', '2026년 12월 31일~2027년 1월 2일'],
  ])('기간 %s~%s를 줄여 써요', (startDate, endDate, period) => {
    expect(inboxLine({ ...item, startDate, endDate }, now)).toBe(
      `강릉 여행 · ${period} · 장소 5곳`,
    );
  });
  it.each([
    [new Date(2026, 10, 20, 15, 12), '오늘 오후 3:12'],
    [new Date(2026, 10, 19, 9, 5), '어제 오전 9:05'],
    [new Date(2026, 10, 18, 15, 12), '11월 18일 오후 3:12'],
    [new Date(2025, 10, 18, 0, 5), '2025년 11월 18일 오전 12:05'],
    [new Date(2026, 10, 20, 12), '오늘 오후 12:00'],
  ])('받은 때 %s를 로컬 시각으로 써요', (created, received) => {
    expect(fromLine({ ...item, createdAt: created.getTime() }, now)).toBe(
      `여행 도우미 · ${received}`,
    );
  });
  it('연결 이름이 없으면 기본 이름을 써요', () => {
    expect(fromLine({ ...item, from: null }, now)).toBe('이름 없는 연결 · 오늘 오후 3:12');
  });
  it('월과 해의 경계를 넘어도 전날은 어제로 써요', () => {
    expect(
      fromLine(
        { ...item, createdAt: new Date(2026, 11, 31, 23, 59).getTime() },
        new Date(2027, 0, 1),
      ),
    ).toBe('여행 도우미 · 어제 오후 11:59');
  });
  it('범위 순서를 고정해요', () => {
    expect(scopeLabel(['share:create', 'inbox:write'])).toBe('받은함·짧은 링크');
    expect(scopeLabel(['inbox:write', 'library:read', 'library:write'])).toBe('받은함·보관함');
    expect(scopeLabel(['inbox:write'])).toBe('받은함');
    expect(scopeLabel(['share:create'])).toBe('짧은 링크');
  });
  it('만료까지 남은 날은 시각이 아닌 로컬 달력 날짜로 세요', () => {
    expect(expiryLabel(new Date(2027, 0, 30).getTime(), new Date(2026, 10, 1, 23, 59))).toBe(
      '만료 1월 30일(90일 남음)',
    );
    expect(expiryLabel(new Date(2027, 0, 30, 23, 59).getTime(), new Date(2027, 0, 30, 12))).toBe(
      '만료 1월 30일(오늘)',
    );
    expect(expiryLabel(new Date(2027, 0, 30, 9).getTime(), new Date(2027, 0, 30, 12))).toBe(
      '만료됨',
    );
    expect(expiryLabel(new Date(2027, 0, 29).getTime(), new Date(2027, 0, 30))).toBe('만료됨');
  });
});
