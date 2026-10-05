import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from 'src/app';
import { overlay } from 'src/domain/overlay';
import { createMemoryStorage, storageKey } from 'src/repositories/edit-layer-repo';
import { moveStop, removeStop } from 'src/sections/itinerary/store/itinerary-actions';
import { StopEditPanel } from 'src/sections/itinerary/view/StopEditPanel';
import { stopDraftsAtom } from 'src/sections/views/store/view-session';
import { createTripStore, TripStoreContext } from 'src/stores/trip-store';
import { makeEdit, makeTrip } from '../../fixtures/builders';

const DATE = '2026-11-14';
const NEXT = '2026-11-15';
const KEY = storageKey('testtrip0001');
const NOW = '2026-10-03T02:00:00.000Z';
function setupStopEditor(withAuthor = true) {
  const trip = makeTrip({ days: { [DATE]: ['A', 'A2'], [NEXT]: [] } });
  const storage = createMemoryStorage();
  const edit = makeEdit();
  if (withAuthor) storage.setItem(KEY, JSON.stringify(edit));
  const ts = createTripStore('testtrip0001', {
    storage,
    locks: undefined,
    now: () => 1759460000000,
    nowIso: () => NOW,
  });
  const store = createStore();
  store.set(ts.tripAtom, trip);
  store.set(stopDraftsAtom, {
    a000: { date: DATE, time: '', note: '' },
    a200: { date: DATE, time: '11:00', note: '다른 방문' },
  });
  const onClose = vi.fn();
  const node = (id = 'a000') => (
    <AppProviders>
      <TripStoreContext value={ts}>
        <Provider store={store}>
          <StopEditPanel date={DATE} stopId={id} onClose={onClose} />
        </Provider>
      </TripStoreContext>
    </AppProviders>
  );
  const result = render(node());
  return { trip, storage, store, ts, edit, onClose, node, ...result };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('공통 방문 편집', () => {
  it('HH:mm 오류는 저장하지 않고 draft를 유지한다', async () => {
    const { store, storage } = setupStopEditor();
    const before = storage.getItem(KEY);
    await userEvent.type(screen.getByLabelText('A 시간'), '25:61');
    await userEvent.click(screen.getByRole('button', { name: /^저장$/ }));
    expect(screen.getByText('시간은 HH:mm 형식으로 입력하세요')).toBeVisible();
    expect(store.get(stopDraftsAtom).a000?.time).toBe('25:61');
    expect(storage.getItem(KEY)).toBe(before);
  });
  it('같은 placeKey의 다른 stopId 초안과 저장을 분리한다', async () => {
    const { store, ts, onClose } = setupStopEditor();
    await userEvent.type(screen.getByLabelText('A 메모'), '새 방문 메모');
    await userEvent.click(screen.getByRole('button', { name: /^저장$/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(store.get(stopDraftsAtom).a000).toBeUndefined();
    expect(store.get(stopDraftsAtom).a200?.note).toBe('다른 방문');
    const stops = store.get(ts.effectiveTripAtom)!.days[0]!.stops;
    expect(stops[0]?.note).toBe('새 방문 메모');
    expect(stops[1]?.note).toBeUndefined();
  });
  it('닫기 후 다시 열면 초안 유지, 취소하면 해당 초안만 제거한다', async () => {
    const h = setupStopEditor();
    await userEvent.type(screen.getByLabelText('A 메모'), '작성 중');
    h.rerender(<></>);
    expect(h.store.get(stopDraftsAtom).a000?.note).toBe('작성 중');
    h.rerender(h.node());
    expect(screen.getByLabelText('A 메모')).toHaveValue('작성 중');
    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(h.store.get(stopDraftsAtom).a000).toBeUndefined();
    expect(h.store.get(stopDraftsAtom).a200).toBeDefined();
    expect(h.onClose).toHaveBeenCalledOnce();
  });
  it('빈 시간·노트는 기존 필드를 제거하는 null patch로 저장한다', async () => {
    const h = setupStopEditor();
    h.trip.days[0]!.stops[0]!.time = '09:00';
    h.trip.days[0]!.stops[0]!.note = '기존';
    await userEvent.click(screen.getByRole('button', { name: /^저장$/ }));
    await waitFor(() => expect(h.onClose).toHaveBeenCalled());
    expect(overlay(h.trip, JSON.parse(h.storage.getItem(KEY)!)).days[0]!.stops[0]).toEqual({
      id: 'a000',
      placeKey: 'n:1',
    });
  });
  it.each(['삭제', '이동'])('다른 탭에서 %s된 stop은 경고만 보여주며 쓰지 않는다', async (kind) => {
    const h = setupStopEditor();
    const changed =
      kind === '삭제'
        ? removeStop(h.trip, h.edit, DATE, 'a000', NOW)
        : moveStop(h.trip, h.edit, 'a000', DATE, NEXT, NOW);
    const before = JSON.stringify(changed);
    h.storage.setItem(KEY, before);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: KEY })));
    expect(screen.getByText('방문 정보가 변경됐어요. 다시 선택하세요')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^저장$/ })).toBeNull();
    expect(h.storage.getItem(KEY)).toBe(before);
    expect(h.store.get(stopDraftsAtom).a000).toBeDefined();
  });
  it('storage 최신 stop 삭제도 저장 callback에서 검사한다', async () => {
    const h = setupStopEditor();
    const before = JSON.stringify(removeStop(h.trip, h.edit, DATE, 'a000', NOW));
    h.storage.setItem(KEY, before);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await userEvent.click(screen.getByRole('button', { name: /^저장$/ }));
    await screen.findByText('방문 정보가 변경됐어요. 다시 선택하세요');
    expect(h.storage.getItem(KEY)).toBe(before);
    expect(h.onClose).not.toHaveBeenCalled();
    expect(h.store.get(stopDraftsAtom).a000).toBeDefined();
  });
  it('저장 실패는 폼과 초안을 유지한다', async () => {
    const h = setupStopEditor();
    const before = h.storage.getItem(KEY);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(h.storage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await userEvent.type(screen.getByLabelText('A 메모'), '실패 초안');
    await userEvent.click(screen.getByRole('button', { name: /^저장$/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^저장$/ })).not.toBeDisabled());
    expect(h.storage.getItem(KEY)).toBe(before);
    expect(h.store.get(stopDraftsAtom).a000?.note).toBe('실패 초안');
    expect(h.onClose).not.toHaveBeenCalled();
  });
  it('닉네임 취소는 저장 없이 초안을 유지한다', async () => {
    const h = setupStopEditor(false);
    await userEvent.type(screen.getByLabelText('A 메모'), '작성 중');
    await userEvent.click(screen.getByRole('button', { name: /^저장$/ }));
    await waitFor(() => expect(h.store.get(h.ts.nicknameRequestAtom)).not.toBeNull());
    await act(async () => h.store.get(h.ts.nicknameRequestAtom)!.resolve(null));
    expect(h.storage.getItem(KEY)).toBeNull();
    expect(h.store.get(stopDraftsAtom).a000?.note).toBe('작성 중');
    expect(h.onClose).not.toHaveBeenCalled();
  });
  it('저장 대기 중 바뀐 시간과 메모 초안은 이전 값 저장 후에도 유지한다', async () => {
    const h = setupStopEditor(false);
    act(() =>
      h.store.set(stopDraftsAtom, {
        ...h.store.get(stopDraftsAtom),
        a000: { date: DATE, time: '09:00', note: '제출 메모' },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^저장$/ }));
    await waitFor(() => expect(h.store.get(h.ts.nicknameRequestAtom)).not.toBeNull());
    fireEvent.change(screen.getByLabelText('A 시간'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText('A 메모'), { target: { value: '새 초안' } });
    await act(async () => h.store.get(h.ts.nicknameRequestAtom)!.resolve('테스트 사용자'));
    await waitFor(() => expect(h.storage.getItem(KEY)).not.toBeNull());
    const saved = JSON.parse(h.storage.getItem(KEY)!);
    expect(overlay(h.trip, saved).days[0]!.stops[0]).toMatchObject({
      time: '09:00',
      note: '제출 메모',
    });
    expect(h.store.get(stopDraftsAtom).a000).toEqual({
      date: DATE,
      time: '10:00',
      note: '새 초안',
    });
    expect(h.onClose).not.toHaveBeenCalled();
  });
});

it('2000자를 넘는 메모와 다른 날짜 초안은 저장하지 않는다', async () => {
  const h = setupStopEditor();
  const before = h.storage.getItem(KEY);
  fireEvent.change(screen.getByLabelText('A 메모'), { target: { value: '가'.repeat(2001) } });
  await userEvent.click(screen.getByRole('button', { name: /^저장$/ }));
  expect(screen.getByText('메모는 2000자까지 입력하세요')).toBeVisible();
  expect(h.storage.getItem(KEY)).toBe(before);
  act(() => h.store.set(stopDraftsAtom, { a000: { date: NEXT, time: '', note: '다른 날짜' } }));
  expect(screen.getByText('방문 정보가 변경됐어요. 다시 선택하세요')).toBeVisible();
  expect(screen.queryByRole('button', { name: /^저장$/ })).toBeNull();
  expect(h.storage.getItem(KEY)).toBe(before);
});

it.each(['수정', '삭제', '이동'])(
  '초안 복구 클릭 직전 %s된 현재 방문을 store에서 재검증한다',
  (kind) => {
    const h = setupStopEditor();
    act(() =>
      h.store.set(stopDraftsAtom, {
        ...h.store.get(stopDraftsAtom),
        a000: { date: NEXT, time: '09:00', note: '옛 초안' },
      }),
    );
    const reset = screen.getByRole('button', { name: '초안 버리고 다시 편집' });
    const draft = h.store.get(stopDraftsAtom);
    const latest = structuredClone(h.trip);
    if (kind === '이동') latest.days[1]!.stops.push(latest.days[0]!.stops[0]!);
    if (kind === '삭제' || kind === '이동')
      latest.days[0]!.stops = latest.days[0]!.stops.filter((s) => s.id !== 'a000');
    else Object.assign(latest.days[0]!.stops[0]!, { time: '12:30', note: '최신 방문' });
    act(() => {
      h.store.set(h.ts.tripAtom, latest);
      fireEvent.click(reset);
    });
    if (kind === '수정') {
      expect(h.store.get(stopDraftsAtom).a000).toEqual({
        date: DATE,
        time: '12:30',
        note: '최신 방문',
      });
      expect(h.store.get(stopDraftsAtom).a200).toEqual(draft.a200);
    } else {
      expect(h.store.get(stopDraftsAtom)).toBe(draft);
      expect(screen.queryByRole('button', { name: /^저장$/ })).toBeNull();
      expect(screen.queryByRole('button', { name: '초안 버리고 다시 편집' })).toBeNull();
    }
  },
);
