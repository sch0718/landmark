import { render, screen, waitFor, within } from '@testing-library/react';
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
    expect(mocked.resolve).toHaveBeenCalledWith({ 'day.0.startTime': 'theirs' }, mocked.view.merge);
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

it.each([false, true])(
  '같은 겹침 id라도 값·목록이 달라지면 선택을 지우고 알린다 (%s)',
  async (placement) => {
    prepare(placement);
    const { rerender } = mount();
    await userEvent.click(screen.getByRole('button', { name: '모두 공동 여행으로' }));
    const previous = mocked.view.merge as ReturnType<typeof mergeCollabPlan>;
    const theirs = structuredClone(previous.theirs);
    if (placement) theirs.candidates.push(theirs.days[1]!.stops.pop()!.placeId);
    else theirs.days[0]!.startTime = '07:00';
    mocked.view = { ...mocked.view, merge: mergeCollabPlan(previous.base, previous.mine, theirs) };
    const store = createStore();
    store.set(libraryAtom, buildLiveLibrary());
    rerender(
      <Provider store={store}>
        <CollabConflictDialog open tripId="trip000001" onClose={vi.fn()} />
      </Provider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('그사이 공동 여행이 또 바뀌었어요');
    expect(screen.getByRole('button', { name: '고른 대로 맞추기' })).toBeDisabled();
  },
);

function refresh(rerender: ReturnType<typeof mount>['rerender']) {
  const store = createStore();
  store.set(libraryAtom, buildLiveLibrary());
  rerender(
    <Provider store={store}>
      <CollabConflictDialog open tripId="trip000001" onClose={vi.fn()} />
    </Provider>,
  );
}
it('관계없는 Day가 바뀌어도 선택을 유지하고 다시 고르라고 알리지 않는다', async () => {
  const { rerender } = mount();
  await userEvent.click(screen.getByRole('button', { name: '모두 공동 여행으로' }));
  const previous = mocked.view.merge as ReturnType<typeof mergeCollabPlan>;
  const theirs = structuredClone(previous.theirs);
  theirs.days[1]!.stops[0]!.note = '관계없는 메모';
  mocked.view = { ...mocked.view, merge: mergeCollabPlan(previous.base, previous.mine, theirs) };
  refresh(rerender);
  expect(screen.getByRole('button', { name: '고른 대로 맞추기' })).toBeEnabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('바뀐 겹침만 선택을 비우고 그대로인 겹침은 남긴다', async () => {
  const previous = mocked.view.merge as ReturnType<typeof mergeCollabPlan>;
  const mine = structuredClone(previous.mine),
    theirs = structuredClone(previous.theirs);
  mine.title = '내 제목';
  theirs.title = '공동 제목';
  mocked.view = { ...mocked.view, merge: mergeCollabPlan(previous.base, mine, theirs) };
  const { rerender } = mount();
  await userEvent.click(screen.getByRole('button', { name: '모두 공동 여행으로' }));
  theirs.days[0]!.startTime = '07:00';
  mocked.view = { ...mocked.view, merge: mergeCollabPlan(previous.base, mine, theirs) };
  refresh(rerender);
  expect(
    within(screen.getByRole('radiogroup', { name: '여행 이름' })).getByRole('radio', {
      name: '공동 여행',
    }),
  ).toBeChecked();
  expect(
    within(screen.getByRole('radiogroup', { name: 'Day 1 출발 시각' })).getByRole('radio', {
      name: '공동 여행',
    }),
  ).not.toBeChecked();
  expect(screen.getByRole('alert')).toBeVisible();
});
