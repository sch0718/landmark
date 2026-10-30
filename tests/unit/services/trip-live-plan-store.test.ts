import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTripLivePlanStore, TRIP_LIVE_PLAN_KEY } from 'src/services/trip-live/plan-store';
import {
  createTripLiveStore,
  TRIP_LIVE_KEY,
  type TripLiveRecord,
} from 'src/services/trip-live/store';

const record = (tripId = 'trip000001', liveId = 'abcdefghij'): TripLiveRecord => ({
  tripId,
  liveId,
  status: 'live',
  ownerToken: 'o'.repeat(43),
  viewToken: 'v'.repeat(43),
  rev: 1,
  dayIds: ['day00001'],
  options: { title: '여행', includeMemo: false, includeCandidates: true },
  createdAt: '2026-11-01T00:00:00Z',
  publishedKey: '공개 지문',
});

beforeEach(() => localStorage.clear());

function setup(storage?: () => Storage) {
  const liveStore = createTripLiveStore();
  liveStore.put(record());
  return { liveStore, store: createTripLivePlanStore(liveStore, storage) };
}

describe('2B 전용 공개 계획 지문', () => {
  it('전용 키로 왕복하고 2A 기록은 원래 필드만 저장해 소유자 권한을 보존한다', () => {
    const { liveStore, store } = setup();
    store.put('trip000001', 'abcdefghij', '계획 지문');
    expect(JSON.parse(localStorage.getItem(TRIP_LIVE_PLAN_KEY)!)).toEqual({
      trip000001: { liveId: 'abcdefghij', planKey: '계획 지문', publishedKey: '공개 지문' },
    });
    expect(createTripLivePlanStore(createTripLiveStore()).get('trip000001')).toBe('계획 지문');
    expect(Object.keys(JSON.parse(localStorage.getItem(TRIP_LIVE_KEY)!).trip000001).sort()).toEqual(
      [
        'tripId',
        'liveId',
        'status',
        'ownerToken',
        'viewToken',
        'rev',
        'dayIds',
        'options',
        'createdAt',
        'publishedKey',
      ].sort(),
    );
    // 2A에서 다시 읽어 갱신·저장해도 기록과 소유자 권한이 남는다.
    const rolledBack = createTripLiveStore();
    rolledBack.update('trip000001', { rev: 2 });
    expect(liveStore.get('trip000001')).toEqual({ ...record(), rev: 2 });
    expect(store.get('trip000001')).toBe('계획 지문');
  });

  it('갱신한 지문만 남기고 다른 여행의 지문을 보존한다', () => {
    const { liveStore, store } = setup();
    liveStore.put(record('trip000002', 'klmnopqrst'));
    store.put('trip000001', 'abcdefghij', '첫 지문');
    store.put('trip000002', 'klmnopqrst', '다른 여행');
    store.put('trip000001', 'abcdefghij', '갱신 지문');
    expect(store.get('trip000001')).toBe('갱신 지문');
    expect(store.get('trip000002')).toBe('다른 여행');
  });

  it.each([
    null,
    '{',
    'null',
    '[]',
    '1',
    JSON.stringify({ trip000001: {} }),
    JSON.stringify({ trip000001: { liveId: 'abcdefghij', planKey: 1, publishedKey: '공개 지문' } }),
    JSON.stringify({
      trip000001: { liveId: '잘못된 id', planKey: '계획', publishedKey: '공개 지문' },
    }),
    JSON.stringify({
      trip000001: { liveId: 'abcdefghij', planKey: '계획', publishedKey: '공개 지문', extra: true },
    }),
  ])('없거나 손상·형식 오류인 값은 빈 값으로 읽는다(%s)', (raw) => {
    const { store } = setup();
    if (raw !== null) localStorage.setItem(TRIP_LIVE_PLAN_KEY, raw);
    expect(store.get('trip000001')).toBeUndefined();
  });

  it('같은 여행이어도 liveId가 다르면 낡은 지문을 무시한다', () => {
    const { liveStore, store } = setup();
    store.put('trip000001', 'abcdefghij', '이전 공유');
    liveStore.put(record('trip000001', 'klmnopqrst'));
    expect(store.get('trip000001')).toBeUndefined();
    store.put('trip000001', 'abcdefghij', '늦게 도착한 이전 공유');
    expect(store.get('trip000001')).toBeUndefined();
    store.put('trip000001', 'klmnopqrst', '새 공유');
    expect(store.get('trip000001')).toBe('새 공유');
  });

  it('2A로 롤백해 같은 공유를 새로 공개하면 이전 계획 지문을 무시한다', () => {
    const { liveStore, store } = setup();
    store.put('trip000001', 'abcdefghij', '이전 계획');
    liveStore.update('trip000001', { publishedKey: '롤백 뒤 공개 지문' });
    expect(store.get('trip000001')).toBeUndefined();
    expect(createTripLivePlanStore(liveStore).get('trip000001')).toBeUndefined();
    store.put('trip000001', 'abcdefghij', '새 공개 계획');
    expect(store.get('trip000001')).toBe('새 공개 계획');
  });

  it('2A 갱신 뒤 지문 저장만 실패해도 다시 열 때 저장소의 이전 지문은 쓰지 않는다', () => {
    const liveStore = createTripLiveStore();
    liveStore.put(record());
    let blocked = false;
    const store = createTripLivePlanStore(
      liveStore,
      () =>
        ({
          getItem: (key: string) => localStorage.getItem(key),
          setItem: (key: string, value: string) => {
            if (blocked) throw Error('저장소 상한');
            localStorage.setItem(key, value);
          },
        }) as Storage,
    );
    store.put('trip000001', 'abcdefghij', '이전 계획');
    liveStore.update('trip000001', { publishedKey: '다음 공개 지문' });
    blocked = true;
    store.put('trip000001', 'abcdefghij', '새 공개 계획');
    expect(store.get('trip000001')).toBe('새 공개 계획');
    expect(createTripLivePlanStore(liveStore).get('trip000001')).toBeUndefined();
  });

  it('그만두기·서버 지우기로 2A 기록이 없으면 무시하고 다음 저장 때 정리한다', () => {
    const { liveStore, store } = setup();
    store.put('trip000001', 'abcdefghij', '계획 지문');
    liveStore.remove('trip000001');
    expect(store.get('trip000001')).toBeUndefined();
    expect(createTripLivePlanStore(liveStore).get('trip000001')).toBeUndefined();
    liveStore.put(record('trip000002', 'klmnopqrst'));
    store.put('trip000002', 'klmnopqrst', '새 지문');
    expect(JSON.parse(localStorage.getItem(TRIP_LIVE_PLAN_KEY)!)).toEqual({
      trip000002: { liveId: 'klmnopqrst', planKey: '새 지문', publishedKey: '공개 지문' },
    });
  });

  it('2A 기록 상한에서 빠진 여행의 지문은 쓰지 않는다', () => {
    const { liveStore, store } = setup();
    store.put('trip000001', 'abcdefghij', '계획 지문');
    for (let i = 0; i < 100; i++)
      liveStore.put({
        ...record(`t${String(i).padStart(9, '0')}`),
        createdAt: '2026-12-01T00:00:00Z',
      });
    expect(liveStore.get('trip000001')).toBeUndefined();
    expect(store.get('trip000001')).toBeUndefined();
    store.put('t000000000', 'abcdefghij', '남은 여행');
    expect(JSON.parse(localStorage.getItem(TRIP_LIVE_PLAN_KEY)!)).not.toHaveProperty('trip000001');
  });

  it.each(['getItem', 'setItem'] as const)(
    '저장소 %s이 막히면 페이지 메모리로 계속한다',
    (method) => {
      const storage = {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
      };
      storage[method].mockImplementation(() => {
        throw Error('저장소 차단');
      });
      const { store } = setup(() => storage as unknown as Storage);
      store.put('trip000001', 'abcdefghij', '첫 지문');
      expect(store.get('trip000001')).toBe('첫 지문');
      store.put('trip000001', 'abcdefghij', '다음 지문');
      expect(store.get('trip000001')).toBe('다음 지문');
    },
  );

  it('다른 탭의 지문·2A liveId 변경을 다음 읽기에 반영한다', () => {
    const { liveStore, store } = setup();
    store.put('trip000001', 'abcdefghij', '첫 지문');
    localStorage.setItem(
      TRIP_LIVE_PLAN_KEY,
      JSON.stringify({
        trip000001: { liveId: 'abcdefghij', planKey: '다른 탭', publishedKey: '공개 지문' },
      }),
    );
    expect(store.get('trip000001')).toBe('다른 탭');
    createTripLiveStore().put(record('trip000001', 'klmnopqrst'));
    expect(store.get('trip000001')).toBeUndefined();
    expect(liveStore.get('trip000001')?.liveId).toBe('klmnopqrst');
  });
});
