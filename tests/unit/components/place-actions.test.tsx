import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findDuplicateStopIds, overlay } from 'src/domain/overlay';
import { createMemoryStorage, storageKey } from 'src/repositories/edit-layer-repo';
import type { EditLayer } from 'src/schema/edit-layer';
import { usePlaceActions } from 'src/sections/explore/store/use-place-actions';
import { createTripStore, TripStoreContext } from 'src/stores/trip-store';
import { makeEdit, makeTrip } from '../../fixtures/builders';

const DATE = '2026-11-14';
const NOW = '2026-10-03T02:00:00.000Z';
const KEY = storageKey('testtrip0001');
function setup(edit: EditLayer | null = makeEdit(), key = 'n:1', count = 1) {
  const trip = makeTrip({ days: { [DATE]: Array.from({ length: count }, (_, i) => `A${i + 1}`) } });
  trip.days[0]!.stops.forEach((stop, i) => {
    stop.id = `visit${i}`;
  });
  const storage = createMemoryStorage();
  if (edit) storage.setItem(KEY, JSON.stringify(edit));
  const ts = createTripStore(trip.publicId, {
    storage,
    locks: undefined,
    now: () => 1759460000000,
    nowIso: () => NOW,
  });
  const store = createStore();
  store.set(ts.tripAtom, trip);
  store.set(ts.editLayerAtom, edit);
  const hook = renderHook(() => usePlaceActions(key), {
    wrapper: ({ children }) => (
      <TripStoreContext value={ts}>
        <Provider store={store}>{children}</Provider>
      </TripStoreContext>
    ),
  });
  return {
    ...hook,
    storage,
    ts,
    store,
    trip,
    saved: () => JSON.parse(storage.getItem(KEY)!) as EditLayer,
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('usePlaceActions', () => {
  it('본인 메모만 저장·삭제하고 동행 메모와 나머지 필드를 보존한다', async () => {
    const other = { text: '동행', updatedAt: NOW };
    const h = setup(
      makeEdit({
        authors: {
          'a-local': { nickname: '나', updatedAt: NOW },
          other: { nickname: '동행', updatedAt: NOW },
        },
        places: { 'n:1': { memos: { other }, tags: { value: ['태그'], updatedAt: NOW } } },
      }),
    );
    await act(async () => expect(await h.result.current.setMemo(' 내 메모 ')).toBe('saved'));
    expect(h.saved().places['n:1']!.memos).toEqual({
      other,
      'a-local': { text: '내 메모', updatedAt: NOW },
    });
    await act(async () => expect(await h.result.current.setMemo(null)).toBe('saved'));
    expect(h.saved().places['n:1']!.memos.other).toEqual(other);
    expect(h.saved().places['n:1']!.memos['a-local']!.text).toBeNull();
    expect(h.saved().places['n:1']!.tags!.value).toEqual(['태그']);
  });
  it('태그를 정리하고 숨김을 저장한다', async () => {
    const h = setup();
    await act(async () => expect(await h.result.current.setTags([' 야경 ', '야경'])).toBe('saved'));
    await act(async () => expect(await h.result.current.setHidden(true)).toBe('saved'));
    expect(h.saved().places['n:1']).toMatchObject({
      tags: { value: ['야경'], updatedAt: NOW },
      hidden: { value: true, updatedAt: NOW },
    });
  });
  it.each(['memo', 'tags', 'hidden', 'day'])(
    '닉네임 취소 시 %s는 cancelled이고 저장하지 않는다',
    async (action) => {
      const h = setup(null);
      let pending!: Promise<string>;
      act(() => {
        pending =
          action === 'memo'
            ? h.result.current.setMemo('메모')
            : action === 'tags'
              ? h.result.current.setTags(['태그'])
              : action === 'hidden'
                ? h.result.current.setHidden(true)
                : h.result.current.addToDay(DATE);
      });
      void pending.catch(() => {});
      await waitFor(() => expect(h.store.get(h.ts.nicknameRequestAtom)).not.toBeNull());
      await act(async () => {
        h.store.get(h.ts.nicknameRequestAtom)!.resolve(null);
        expect(await pending).toBe('cancelled');
      });
      expect(h.storage.getItem(KEY)).toBeNull();
      expect(h.store.get(h.ts.editLayerAtom)).toBeNull();
    },
  );
  it('50곳인 날에는 limit을 반환하고 편집을 바꾸지 않는다', async () => {
    const h = setup(makeEdit(), 'n:1', 50);
    const before = h.storage.getItem(KEY);
    await act(async () => expect(await h.result.current.addToDay(DATE)).toBe('limit'));
    expect(h.storage.getItem(KEY)).toBe(before);
    expect(findDuplicateStopIds(overlay(h.trip, h.saved()).days)).toEqual([]);
  });
  it('같은 장소를 두 번 추가해도 각 방문 ID가 다르다', async () => {
    const h = setup();
    await act(async () => {
      expect(await h.result.current.addToDay(DATE)).toBe('saved');
      expect(await h.result.current.addToDay(DATE)).toBe('saved');
    });
    const effective = overlay(h.trip, h.saved());
    expect(effective.days[0]!.stops).toHaveLength(3);
    expect(new Set(effective.days[0]!.stops.map((s) => s.id)).size).toBe(3);
    expect(findDuplicateStopIds(effective.days)).toEqual([]);
  });
  it('메모와 태그 한도를 검증하고 최대값은 저장한다', async () => {
    const h = setup();
    for (const text of ['', '   ', '가'.repeat(2001)])
      await expect(h.result.current.setMemo(text)).rejects.toThrow(RangeError);
    for (const tags of [[''], ['가'.repeat(31)], Array.from({ length: 21 }, (_, i) => String(i))])
      await expect(h.result.current.setTags(tags)).rejects.toThrow(RangeError);
    await act(async () => {
      expect(await h.result.current.setMemo('가'.repeat(2000))).toBe('saved');
      expect(
        await h.result.current.setTags(
          Array.from({ length: 20 }, (_, i) => String(i).padEnd(30, '가')),
        ),
      ).toBe('saved');
    });
  });
  it.each(['n:missing', 'toString', 'constructor', '__proto__'])(
    '없는 장소 %s의 모든 변경을 거절한다',
    async (key) => {
      const h = setup(makeEdit(), key);
      const before = h.storage.getItem(KEY);
      await expect(h.result.current.setMemo('메모')).rejects.toThrow(RangeError);
      await expect(h.result.current.setTags(['태그'])).rejects.toThrow(RangeError);
      await expect(h.result.current.setHidden(true)).rejects.toThrow(RangeError);
      await expect(h.result.current.addToDay(DATE)).rejects.toThrow(RangeError);
      expect(h.storage.getItem(KEY)).toBe(before);
    },
  );
  it('여행에 없는 날짜를 거절한다', async () => {
    const h = setup();
    await expect(h.result.current.addToDay('2026-11-99')).rejects.toThrow(RangeError);
    await expect(h.result.current.addToDay('2026-11-15')).rejects.toThrow(RangeError);
  });
  it.each(['memo', 'tags', 'hidden', 'day'])(
    'storage 실패를 %s 호출자에게 전달하고 원본을 보존한다',
    async (action) => {
      const h = setup();
      const before = h.storage.getItem(KEY);
      const error = new Error('storage rejected');
      vi.spyOn(h.storage, 'setItem').mockImplementation(() => {
        throw error;
      });
      await act(async () => {
        const pending =
          action === 'memo'
            ? h.result.current.setMemo('메모')
            : action === 'tags'
              ? h.result.current.setTags(['태그'])
              : action === 'hidden'
                ? h.result.current.setHidden(true)
                : h.result.current.addToDay(DATE);
        await expect(pending).rejects.toBe(error);
      });
      expect(h.storage.getItem(KEY)).toBe(before);
      expect(h.store.get(h.ts.editLayerAtom)).toEqual(makeEdit());
    },
  );
});
