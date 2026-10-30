import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collabBaseKey,
  createTripCollabStore,
  TRIP_COLLAB_KEY,
  type TripCollabRecord,
} from 'src/services/trip-collab/store';
import { mkPlan } from '../domain/trip-collab/builders';
const record = (
  tripId = 'trip000001',
  syncedAt = '2026-11-01T00:00:00.000Z',
): TripCollabRecord => ({
  tripId,
  liveId: tripId,
  role: 'editor',
  token: 'e'.repeat(43),
  deviceId: 'device01',
  label: '내 폰',
  status: 'live',
  rev: 1,
  prev: 0,
  dayIds: ['day00001'],
  placeMap: {},
  syncedAt,
  title: '여행',
  pendingProgress: [],
});
const base = () => ({ rev: 1, plan: mkPlan({ days: [['a']] }), progress: null });
beforeEach(() => localStorage.clear());
describe('함께 편집 기기 기록', () => {
  it('왕복·수정·공유 조회와 같은 원문의 스냅샷을 유지한다', () => {
    const s = createTripCollabStore();
    s.put(record());
    expect(s.get('trip000001')).toEqual(record());
    expect(s.byLiveId('trip000001')).toEqual(record());
    expect(s.list()).toBe(s.list());
    s.update('trip000001', { rev: 2 });
    expect(createTripCollabStore().get('trip000001')?.rev).toBe(2);
  });
  it('깨진 JSON과 틀린 항목은 버린다', () => {
    localStorage.setItem(TRIP_COLLAB_KEY, '{');
    expect(createTripCollabStore().list()).toEqual([]);
    localStorage.setItem(
      TRIP_COLLAB_KEY,
      JSON.stringify({
        trip000001: record(),
        wrong: record(),
        trip000002: { ...record('trip000002'), token: '짧음' },
      }),
    );
    expect(createTripCollabStore().list()).toEqual([record()]);
  });
  it('기록을 지우면 기준 키도 지우고 틀린 기준은 읽지 않는다', () => {
    const s = createTripCollabStore();
    s.put(record());
    s.writeBase('trip000001', base());
    expect(createTripCollabStore().readBase('trip000001')).toEqual(base());
    s.remove('trip000001');
    expect(localStorage.getItem(collabBaseKey('trip000001'))).toBeNull();
    expect(s.readBase('trip000001')).toBeNull();
    localStorage.setItem(collabBaseKey('trip000001'), JSON.stringify({ rev: -1, plan: {} }));
    expect(s.readBase('trip000001')).toBeNull();
  });
  it('101번째에는 가장 오래된 기록과 기준을 버린다', () => {
    const s = createTripCollabStore();
    for (let i = 0; i < 101; i++) {
      const id = `t${String(i).padStart(9, '0')}`;
      s.writeBase(id, base());
      s.put(record(id, new Date(1_800_000_000_000 + i * 1000).toISOString()));
    }
    expect(s.list()).toHaveLength(100);
    expect(s.get('t000000000')).toBeUndefined();
    expect(localStorage.getItem(collabBaseKey('t000000000'))).toBeNull();
  });
  it('기준 쓰기가 막히면 메모리로 계속 읽고 기록도 메모리에 둔다', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('막힘');
      },
      removeItem: vi.fn(),
    } as unknown as Storage;
    const s = createTripCollabStore(() => storage);
    s.writeBase('trip000001', base());
    expect(s.readBase('trip000001')).toEqual(base());
    s.put(record());
    expect(s.get('trip000001')).toEqual(record());
    s.remove('trip000001');
    expect(s.readBase('trip000001')).toBeNull();
  });
  it('다른 탭의 storage 이벤트가 구독자와 목록을 갱신한다', () => {
    const s = createTripCollabStore(),
      fn = vi.fn(),
      off = s.subscribe(fn);
    s.list();
    localStorage.setItem(TRIP_COLLAB_KEY, JSON.stringify({ trip000001: record() }));
    window.dispatchEvent(new StorageEvent('storage', { key: TRIP_COLLAB_KEY }));
    expect(fn).toHaveBeenCalledOnce();
    expect(s.list()).toEqual([record()]);
    off();
  });
});
