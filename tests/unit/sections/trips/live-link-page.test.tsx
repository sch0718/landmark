import { tripLivePlanStore } from 'src/services/trip-live/plan-store';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider, createStore } from 'jotai';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TripLiveLinkPage } from 'src/sections/trips/live/TripLiveLinkPage';
import { tripLiveApi } from 'src/services/trip-live/client';
import { tripCollabStore } from 'src/services/trip-collab/store';
import { TRIP_LIVE_KEY, tripLiveStore } from 'src/services/trip-live/store';
import { libraryAtom } from 'src/stores/library-state';
import {
  buildLiveTripDoc,
  ESTIMATE_ONLY,
  liveEditKey,
  livePlanKey,
} from 'src/domain/trip-live/build-live-doc';
import { emptyLibrary } from 'src/schema/library';
import { buildLiveLibrary } from '../../../fixtures/builders';
import { buildLiveDoc, LIVE_RECORD_2A_KEYS } from '../../../fixtures/live-trip';
vi.mock('src/services/trip-live/client', () => ({ tripLiveApi: { get: vi.fn() } }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock('src/stores/library-state', async (original) => {
  const mod = await original<typeof import('src/stores/library-state')>();
  const { useStore } = await import('jotai');
  return {
    ...mod,
    useLibraryAction: () => {
      const store = useStore();
      let n = 0;
      return {
        run: async (op: (...args: unknown[]) => unknown) => {
          const r = op(store.get(mod.libraryAtom), {
            now: '2026-11-01T00:00:00Z',
            newId: (kind: string) =>
              `${kind === 'stop' ? 's' : 'p'}${String(++n).padStart(kind === 'stop' ? 7 : 9, '0')}`,
          }) as { ok: boolean; createdId: string; lib: ReturnType<typeof emptyLibrary> };
          if (r.ok) store.set(mod.libraryAtom, r.lib);
          return r;
        },
      };
    },
  };
});
const owner = 'o'.repeat(43),
  id = 'abcdefghij';
const state = () => ({
  rev: 2,
  updatedAt: '2026-11-01T00:00:00Z',
  expiresAt: '2027-01-01',
  role: 'owner' as const,
  doc: buildLiveDoc(),
  viewToken: 'v'.repeat(43),
  sourceTripId: 'trip000001',
});
function Destination() {
  return <p>{useLocation().pathname}</p>;
}
function mount(library = emptyLibrary()) {
  const store = createStore();
  store.set(libraryAtom, library);
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/trips/live/${id}`]}>
        <Routes>
          <Route path="/trips/live/:id" element={<TripLiveLinkPage />} />
          <Route path="*" element={<Destination />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return store;
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  history.replaceState(null, '', `/trips/live/${id}#h=${owner}`);
  vi.mocked(tripLiveApi.get).mockResolvedValue({ ok: true, value: state() });
});
afterEach(() => history.replaceState(null, '', '/'));
describe('소유자 링크', () => {
  it('해시를 지우고 새 여행을 담아 계획 화면으로 가며 처음 지문을 기록한다', async () => {
    const store = mount();
    await screen.findByRole('button', { name: '이 기기에서 관리하기' });
    expect(location.hash).toBe('');
    await userEvent.click(screen.getByRole('button', { name: '이 기기에서 관리하기' }));
    await screen.findByText('/trips/trip000001');
    const r = tripLiveStore.byLiveId(id)!;
    expect(
      Object.keys(JSON.parse(localStorage.getItem(TRIP_LIVE_KEY)!)[r.tripId]).filter(
        (key) => !LIVE_RECORD_2A_KEYS.has(key),
      ),
    ).toEqual([]);
    expect(r.status).toBe('live');
    const lib = store.get(libraryAtom);
    expect(lib.trips[r.tripId]!.days.map((d) => d.stops.value.map((s) => s.id))).toEqual(
      buildLiveDoc().ids.stops,
    );
    expect(tripLivePlanStore.get(r.tripId)).toBe(
      await livePlanKey(
        buildLiveTripDoc(lib, r.tripId, ESTIMATE_ONLY, {
          title: r.options.title,
          options: r.options,
          dayIds: r.dayIds,
          createdAt: r.createdAt,
        })!,
      ),
    );
    expect(r.publishedKey).toBe(
      await liveEditKey(
        buildLiveTripDoc(lib, r.tripId, ESTIMATE_ONLY, {
          title: r.options.title,
          options: r.options,
          dayIds: r.dayIds,
          createdAt: r.createdAt,
        })!,
      ),
    );
  });
  it.each([
    ['unauthorized', '이 관리 링크는 더 쓸 수 없어요'],
    ['ended', '공유가 끝난 일정이에요'],
  ])('%s 안내를 보인다', async (error, message) => {
    vi.mocked(tripLiveApi.get).mockResolvedValue({ ok: false, error: error as 'ended' });
    mount();
    expect(await screen.findByText(new RegExp(message))).toBeVisible();
  });
  it('토큰 없는 주소는 관리 링크가 아니라는 안내를 보인다', async () => {
    history.replaceState(null, '', `/trips/live/${id}`);
    mount();
    expect(await screen.findByText(/관리 링크가 아니에요/)).toBeVisible();
    expect(tripLiveApi.get).not.toHaveBeenCalled();
  });
  it('오프라인이면 다시 시도할 수 있다', async () => {
    vi.mocked(tripLiveApi.get).mockResolvedValueOnce({ ok: false, error: 'offline' });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('button', { name: '이 기기에서 관리하기' })).toBeVisible();
    await waitFor(() => expect(tripLiveApi.get).toHaveBeenCalledTimes(2));
  });
});

it('끊긴 기록이 있어도 새 소유자 링크로 공개본을 확인하고 다시 연결한다', async () => {
  tripLiveStore.put({
    tripId: 'trip000001',
    liveId: id,
    status: 'disconnected',
    ownerToken: 'x'.repeat(43),
    viewToken: 'v'.repeat(43),
    rev: 1,
    dayIds: ['day00001', 'day00002'],
    options: { title: '시험 여행', includeMemo: false, includeCandidates: true },
    createdAt: '2026-11-01T00:00:00.000Z',
  });
  mount(buildLiveLibrary());
  await userEvent.click(await screen.findByRole('button', { name: '이 기기에서 관리하기' }));
  await waitFor(() => expect(tripLiveStore.byLiveId(id)?.ownerToken).toBe(owner));
});

it('v2 공동본은 소유자 연결 기록과 기준을 함께 만든다', async () => {
  const live = state();
  live.doc.v = 2;
  vi.mocked(tripLiveApi.get).mockResolvedValue({ ok: true, value: live });
  const jotai = mount();
  await userEvent.click(await screen.findByRole('button', { name: '이 기기에서 관리하기' }));
  await waitFor(() => expect(tripCollabStore.byLiveId(id)?.role).toBe('owner'));
  const r = tripCollabStore.byLiveId(id)!;
  expect(tripCollabStore.readBase(id)?.rev).toBe(live.rev);
  expect(jotai.get(libraryAtom).trips[r.tripId]!.days[0]!.stops.value[0]!.id).toBe('stop0001');
});
