import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTripLiveStore,
  TRIP_LIVE_KEY,
  type TripLiveRecord,
} from 'src/services/trip-live/store';
import { newLiveToken, newLiveId, newDayId } from 'src/services/trip-live/tokens';
const record = (tripId = 'trip000001', createdAt = '2026-11-01T00:00:00Z'): TripLiveRecord => ({
  tripId,
  liveId: 'abcdefghij',
  status: 'live',
  ownerToken: 'o'.repeat(43),
  viewToken: 'v'.repeat(43),
  rev: 1,
  dayIds: ['day00001'],
  options: { title: '여행', includeMemo: false, includeCandidates: true },
  createdAt,
});
beforeEach(() => localStorage.clear());
describe('갱신 공유 기기 기록', () => {
  it('왕복·조회·수정·삭제와 같은 원문 스냅샷', () => {
    const s = createTripLiveStore();
    s.put(record());
    expect(s.get('trip000001')).toEqual(record());
    expect(s.byLiveId('abcdefghij')).toEqual(record());
    expect(s.list()).toBe(s.list());
    s.update('trip000001', { rev: 2 });
    expect(createTripLiveStore().get('trip000001')?.rev).toBe(2);
    s.remove('trip000001');
    expect(s.list()).toEqual([]);
  });
  it('깨진 JSON은 빈 목록이고 틀린 항목만 버린다', () => {
    localStorage.setItem(TRIP_LIVE_KEY, '{');
    expect(createTripLiveStore().list()).toEqual([]);
    localStorage.setItem(
      TRIP_LIVE_KEY,
      JSON.stringify({ trip000001: record(), bad: {}, mismatch: record() }),
    );
    expect(createTripLiveStore().list()).toEqual([record()]);
  });
  it('저장소가 막혀도 메모리로 계속한다', () => {
    const s = createTripLiveStore(
      () =>
        ({
          getItem() {
            return null;
          },
          setItem() {
            throw Error('막힘');
          },
        }) as unknown as Storage,
    );
    s.put(record());
    s.update('trip000001', { rev: 2 });
    expect(s.get('trip000001')?.rev).toBe(2);
    expect(s.list()).toBe(s.list());
  });
  it('100개를 넘으면 가장 오래된 것을 버린다', () => {
    const s = createTripLiveStore();
    for (let i = 0; i < 101; i++)
      s.put(
        record(
          `t${String(i).padStart(9, '0')}`,
          new Date(1_800_000_000_000 + i * 1000).toISOString(),
        ),
      );
    expect(s.list()).toHaveLength(100);
    expect(s.get('t000000000')).toBeUndefined();
  });
  it('다른 탭 storage 이벤트가 구독자와 스냅샷을 갱신한다', () => {
    const s = createTripLiveStore(),
      fn = vi.fn();
    const off = s.subscribe(fn);
    s.list();
    localStorage.setItem(TRIP_LIVE_KEY, JSON.stringify({ trip000001: record() }));
    window.dispatchEvent(new StorageEvent('storage', { key: TRIP_LIVE_KEY }));
    expect(fn).toHaveBeenCalledOnce();
    expect(s.list()).toEqual([record()]);
    off();
  });
  it('토큰과 id는 길이·문자 집합을 지키며 서로 다르다', () => {
    expect(newLiveToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newLiveId()).toMatch(/^[a-z0-9]{10}$/);
    expect(newDayId()).toMatch(/^[a-z0-9]{8}$/);
    expect(newLiveToken()).not.toBe(newLiveToken());
    expect(newLiveId()).not.toBe(newLiveId());
  });
});
