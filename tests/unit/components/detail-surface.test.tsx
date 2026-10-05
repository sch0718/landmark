import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { afterEach, expect, it, vi } from 'vitest';
import { AppProviders } from 'src/app';
import { overlay } from 'src/domain/overlay';
import { createMemoryStorage, storageKey } from 'src/repositories/edit-layer-repo';
import { exploreFilterAtom, mapViewportUsableAtom } from 'src/sections/explore/store/explore-state';
import {
  detailAtom,
  memoDraftsAtom,
  stopDraftsAtom,
  type DetailState,
} from 'src/sections/views/store/view-session';
import { DetailSurface } from 'src/sections/views/view/DetailSurface';
import { createTripStore, TripStoreContext } from 'src/stores/trip-store';
import { viewModeAtom } from 'src/stores/ui-store';
import { makeEdit, makeTrip } from '../../fixtures/builders';
import { createHeldLocks } from '../../fixtures/fake-locks';

const DATE = '2026-11-14';
const KEY = storageKey('testtrip0001');
function setup({
  locks = undefined as LockManager | undefined,
  count = 0,
  author = true,
  modal = true,
  detail = { kind: 'add', placeKey: 'n:1' } as DetailState,
} = {}) {
  const trip = makeTrip({
    days: { [DATE]: Array.from({ length: count }, (_, i) => `A${i + 1}`) },
    places: ['A'],
  });
  const edit = author ? makeEdit() : null;
  const storage = createMemoryStorage();
  if (edit) storage.setItem(KEY, JSON.stringify(edit));
  const ts = createTripStore('testtrip0001', {
    storage,
    locks,
    now: () => 1759460000000,
    nowIso: () => '2026-10-03T02:00:00.000Z',
  });
  const store = createStore();
  store.set(ts.tripAtom, trip);
  store.set(ts.editLayerAtom, edit);
  store.set(detailAtom, detail);
  const onClose = vi.fn(() => store.set(detailAtom, null));
  render(
    <AppProviders>
      <TripStoreContext value={ts}>
        <Provider store={store}>
          <DetailSurface onClose={onClose} modal={modal} />
        </Provider>
      </TripStoreContext>
    </AppProviders>,
  );
  return { trip, edit, store, storage, ts, onClose };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('날짜 추가는 저장 성공 후 닫는다', async () => {
  const h = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Day 1 (11/14)' }));
  await waitFor(() => expect(h.store.get(detailAtom)).toBeNull());
  expect(overlay(h.trip, JSON.parse(h.storage.getItem(KEY)!)).days[0]?.stops[0]?.placeKey).toBe(
    'n:1',
  );
  expect(h.onClose).toHaveBeenCalledOnce();
});
it('50곳 한도이면 닫거나 저장하지 않고 다시 선택할 수 있다', async () => {
  const h = setup({ count: 50 });
  const before = h.storage.getItem(KEY);
  await userEvent.click(screen.getByRole('button', { name: 'Day 1 (11/14)' }));
  expect(await screen.findByText('하루에 50곳까지 넣을 수 있어요')).toBeVisible();
  expect(h.storage.getItem(KEY)).toBe(before);
  expect(h.onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Day 1 (11/14)' })).toBeEnabled();
});
it('닉네임을 취소하면 열린 상세와 저장 전 상태를 유지한다', async () => {
  const h = setup({ author: false });
  await userEvent.click(screen.getByRole('button', { name: 'Day 1 (11/14)' }));
  expect(screen.getByRole('button', { name: 'Day 1 (11/14)' })).toBeDisabled();
  await waitFor(() => expect(h.store.get(h.ts.nicknameRequestAtom)).not.toBeNull());
  await act(async () => h.store.get(h.ts.nicknameRequestAtom)!.resolve(null));
  expect(h.onClose).not.toHaveBeenCalled();
  expect(h.storage.getItem(KEY)).toBeNull();
  expect(screen.getByRole('button', { name: 'Day 1 (11/14)' })).toBeEnabled();
});
it('저장 실패는 상세를 닫지 않고 오류를 알리며 원본을 보존한다', async () => {
  const h = setup();
  const before = h.storage.getItem(KEY);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(h.storage, 'setItem').mockImplementation(() => {
    throw new Error('storage rejected');
  });
  await userEvent.click(screen.getByRole('button', { name: 'Day 1 (11/14)' }));
  expect(await screen.findByText('편집을 저장하지 못했어요')).toBeVisible();
  expect(h.onClose).not.toHaveBeenCalled();
  expect(h.storage.getItem(KEY)).toBe(before);
  expect(h.store.get(h.ts.editLayerAtom)).toEqual(h.edit);
  expect(screen.getByRole('button', { name: 'Day 1 (11/14)' })).toBeEnabled();
});
it.each(['n:missing', 'constructor', 'toString', '__proto__'])(
  '유효하지 않은 장소 %s는 날짜 추가를 제공하지 않는다',
  (placeKey) => {
    setup({ detail: { kind: 'add', placeKey } });
    expect(screen.getByText('장소를 찾을 수 없어요')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Day 1 (11/14)' })).toBeNull();
  },
);
it.each([true, false])('modal=%s 계약과 Escape 닫기를 유지한다', (modal) => {
  const h = setup({ modal });
  const dialog = screen.getByRole('dialog', { name: '일정에 추가' });
  if (modal) expect(dialog).toHaveAttribute('aria-modal', 'true');
  else expect(dialog).not.toHaveAttribute('aria-modal');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(h.onClose).toHaveBeenCalledOnce();
});
it('장소 상세의 일정 추가는 공통 날짜 선택 상세로 전환하고 Escape로 닫힌다', async () => {
  const h = setup({ detail: { kind: 'place', placeKey: 'n:1' } });
  await userEvent.click(screen.getByRole('button', { name: '일정에 추가' }));
  expect(h.store.get(detailAtom)).toEqual({ kind: 'add', placeKey: 'n:1' });
  const dialog = screen.getByRole('dialog', { name: '일정에 추가' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.getByRole('button', { name: 'Day 1 (11/14)' })).toBeVisible();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(h.onClose).toHaveBeenCalledOnce();
  expect(h.store.get(detailAtom)).toBeNull();
});
it('실제 자식 Menu의 Escape는 부모 상세까지 닫지 않는다', async () => {
  function MenuHarness() {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    return (
      <>
        <button onClick={(event) => setAnchor(event.currentTarget)}>자식 메뉴 열기</button>
        <Menu open={anchor !== null} anchorEl={anchor} onClose={() => setAnchor(null)}>
          <MenuItem>자식 항목</MenuItem>
        </Menu>
      </>
    );
  }
  const h = setup({ detail: { kind: 'place', placeKey: 'n:1' } });
  const parent = screen.getByRole('dialog', { name: '장소 상세' });
  render(<MenuHarness />);
  await userEvent.click(screen.getByRole('button', { name: '자식 메뉴 열기' }));
  expect(screen.getByRole('menu')).toBeVisible();
  fireEvent.keyDown(parent, { key: 'Escape' });
  expect(h.onClose).not.toHaveBeenCalled();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(h.onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: '장소 상세' })).toBeVisible();
});
it('종류 변경과 공통 닫기는 방문 및 메모 세션 초안을 보존한다', async () => {
  const h = setup({ count: 1, detail: { kind: 'stop', date: DATE, stopId: 'a100' } });
  act(() => {
    h.store.set(stopDraftsAtom, { a100: { date: DATE, time: '', note: '' } });
    h.store.set(memoDraftsAtom, { 'n:1': '미저장 메모' });
  });
  await userEvent.type(screen.getByLabelText('A 메모'), '방문 초안');
  act(() => h.store.set(detailAtom, { kind: 'filter' }));
  expect(screen.getByRole('dialog', { name: '필터' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: '닫기' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(h.store.get(memoDraftsAtom)).toEqual({ 'n:1': '미저장 메모' });
  act(() => h.store.set(detailAtom, { kind: 'stop', date: DATE, stopId: 'a100' }));
  expect(screen.getByLabelText('A 메모')).toHaveValue('방문 초안');
});
it.each(['places', 'map'] as const)(
  '필터는 %s 뷰의 사용할 수 없는 지도 영역을 안내하고 의도를 보존한다',
  (view) => {
    const h = setup({ detail: { kind: 'filter' } });
    act(() => {
      h.store.set(viewModeAtom, view);
      h.store.set(mapViewportUsableAtom, false);
      h.store.set(exploreFilterAtom, { ...h.store.get(exploreFilterAtom), inViewOnly: true });
    });
    const checkbox = screen.getByRole('checkbox', { name: '지도 영역 안만 보기' });
    expect(checkbox).toBeDisabled();
    expect(checkbox).toBeChecked();
    expect(screen.getByText('지도 보기에서 적용돼요')).toBeVisible();
  },
);

it.each([
  ['add', false],
  ['add', true],
  ['stop', false],
  ['stop', true],
] as const)(
  '%s 이전 저장 완료는 새 상세를 닫지 않는다 (같은 대상 재개방=%s)',
  async (kind, reopen) => {
    const held = createHeldLocks();
    held.hold();
    const original: DetailState =
      kind === 'add'
        ? { kind: 'add', placeKey: 'n:1' }
        : { kind: 'stop', date: DATE, stopId: 'a100' };
    const h = setup({ count: 1, detail: original, locks: held.locks });
    if (kind === 'stop')
      act(() =>
        h.store.set(stopDraftsAtom, { a100: { date: DATE, time: '09:00', note: '제출 메모' } }),
      );
    const before = h.storage.getItem(KEY);
    await userEvent.click(
      screen.getByRole('button', { name: kind === 'add' ? 'Day 1 (11/14)' : /^저장$/ }),
    );
    await waitFor(() => expect(held.requested).toHaveLength(1));
    expect(h.storage.getItem(KEY)).toBe(before);
    if (reopen) await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    const newer: DetailState = reopen ? { ...original } : { kind: 'place', placeKey: 'n:1' };
    act(() => h.store.set(detailAtom, newer));
    h.onClose.mockClear();
    await act(async () => held.release());
    await waitFor(() => expect(h.storage.getItem(KEY)).not.toBe(before));
    expect(h.store.get(detailAtom)).toBe(newer);
    expect(h.onClose).not.toHaveBeenCalled();
    if (kind === 'stop' && reopen) {
      expect(h.store.get(stopDraftsAtom).a100).toEqual({
        date: DATE,
        time: '09:00',
        note: '제출 메모',
      });
      expect(screen.getByLabelText('A 시간')).toHaveValue('09:00');
      expect(screen.getByLabelText('A 메모')).toHaveValue('제출 메모');
      expect(screen.queryByText('방문 정보가 변경됐어요. 다시 선택하세요')).toBeNull();
      expect(screen.getByRole('button', { name: /^저장$/ })).toBeEnabled();
      fireEvent.change(screen.getByLabelText('A 메모'), { target: { value: '재개방 후 저장' } });
      await userEvent.click(screen.getByRole('button', { name: /^저장$/ }));
      await waitFor(() => expect(h.store.get(detailAtom)).toBeNull());
      expect(h.store.get(stopDraftsAtom).a100).toBeUndefined();
      expect(overlay(h.trip, JSON.parse(h.storage.getItem(KEY)!)).days[0]!.stops[0]!.note).toBe(
        '재개방 후 저장',
      );
    }
  },
);
it('이전 방문 저장은 다른 방문의 열린 초안을 보존하고 기존 세션은 정상 닫는다', async () => {
  const held = createHeldLocks();
  held.hold();
  const h = setup({
    count: 2,
    detail: { kind: 'stop', date: DATE, stopId: 'a100' },
    locks: held.locks,
  });
  act(() =>
    h.store.set(stopDraftsAtom, {
      a100: { date: DATE, time: '09:00', note: 'A 제출' },
      a200: { date: DATE, time: '10:00', note: 'B 초안' },
    }),
  );
  await userEvent.click(screen.getByRole('button', { name: /^저장$/ }));
  await waitFor(() => expect(held.requested).toHaveLength(1));
  const newer: DetailState = { kind: 'stop', date: DATE, stopId: 'a200' };
  act(() => h.store.set(detailAtom, newer));
  await act(async () => held.release());
  await waitFor(() => expect(h.store.get(stopDraftsAtom).a100).toBeUndefined());
  expect(h.store.get(detailAtom)).toBe(newer);
  expect(screen.getByLabelText('A 메모')).toHaveValue('B 초안');
  expect(h.onClose).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: /^저장$/ }));
  await waitFor(() => expect(h.store.get(detailAtom)).toBeNull());
  expect(h.onClose).toHaveBeenCalledOnce();
});
