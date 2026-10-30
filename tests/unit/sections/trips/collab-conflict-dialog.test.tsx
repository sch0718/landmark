import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider, createStore } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CollabConflictDialog } from 'src/sections/trips/collab/CollabConflictDialog';
import { mergeCollabPlan } from 'src/domain/trip-collab/merge';
import { planFromDoc } from 'src/domain/trip-collab/plan';
import { libraryAtom } from 'src/stores/library-state';
import { buildLiveLibrary } from '../../../fixtures/builders';
import { buildLiveDoc } from '../../../fixtures/live-trip';
const mocked = vi.hoisted(() => ({ view: {} as Record<string, unknown>, resolve: vi.fn() }));
vi.mock('src/sections/trips/collab/use-trip-collab', () => ({ useTripCollab: () => mocked.view }));
function prepare(placement = false) {
  const b = planFromDoc(buildLiveDoc()),
    m = structuredClone(b),
    t = structuredClone(b);
  m.days[0]!.startTime = '10:00';
  t.days[0]!.startTime = '08:00';
  if (placement) {
    m.days[1]!.stops.push(m.days[0]!.stops.shift()!);
    t.candidates.push(t.days[0]!.stops.shift()!.placeId);
  }
  mocked.view = {
    state: 'conflict',
    merge: mergeCollabPlan(b, m, t),
    record: { placeMap: { place00001: 'place00001', place00002: 'place00002' } },
    engine: { resolve: mocked.resolve, getSnapshot: () => ({ state: 'synced' }) },
  };
}
function mount() {
  const store = createStore();
  store.set(libraryAtom, buildLiveLibrary());
  return render(
    <Provider store={store}>
      <CollabConflictDialog open tripId="trip000001" onClose={vi.fn()} />
    </Provider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  prepare();
  mocked.resolve.mockResolvedValue(undefined);
});
describe('겹친 변경 비교 창', () => {
  it('두 값을 보여 주고 모두 고르기 전에는 맞추기를 막는다', () => {
    mount();
    expect(screen.getByText('10:00')).toBeVisible();
    expect(screen.getByText('08:00')).toBeVisible();
    expect(screen.getByRole('button', { name: '고른 대로 맞추기' })).toBeDisabled();
  });
  it('모두 공동 여행을 고르면 모든 겹침을 theirs로 푼다', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: '모두 공동 여행으로' }));
    await userEvent.click(screen.getByRole('button', { name: '고른 대로 맞추기' }));
    expect(mocked.resolve).toHaveBeenCalledWith({ 'day.0.startTime': 'theirs' });
  });
  it('배치는 두 열에 장소 이름을 보여 준다', () => {
    prepare(true);
    mount();
    expect(screen.getAllByText('장소 1').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('이 기기').length).toBeGreaterThan(0);
    expect(screen.getAllByText('공동 여행').length).toBeGreaterThan(0);
  });
  it('겹침이 바뀌면 다시 고르라는 문구와 새 선택을 요구한다', async () => {
    const { rerender } = mount();
    await userEvent.click(screen.getByRole('button', { name: '모두 공동 여행으로' }));
    prepare(true);
    const store = createStore();
    store.set(libraryAtom, buildLiveLibrary());
    rerender(
      <Provider store={store}>
        <CollabConflictDialog open tripId="trip000001" onClose={vi.fn()} />
      </Provider>,
    );
    await waitFor(() =>
      expect(screen.getByText('그사이 공동 여행이 또 바뀌었어요. 다시 골라 주세요')).toBeVisible(),
    );
    expect(screen.getByRole('button', { name: '고른 대로 맞추기' })).toBeDisabled();
  });
});
