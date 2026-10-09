import { cleanup, act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import { createStore, Provider, useAtom, useAtomValue, useStore } from 'jotai';
import { useState, type ReactNode } from 'react';
import { LegacyTripScope } from '../../fixtures/legacy-trip-scope';
import {
  useItineraryDays,
  useItineraryLayers,
  useItineraryMarkerClick,
} from 'src/sections/itinerary/store/itinerary-state';
import { MapView } from 'src/components/map/MapView';
import { StopEditPanel } from 'src/sections/itinerary/view/StopEditPanel';
import { Timeline } from 'src/sections/itinerary/view/Timeline';
import { ItineraryPanel } from 'src/sections/itinerary/view/ItineraryPanel';
import {
  detailAtom,
  itineraryEditingAtom,
  mobileRouteMapAtom,
  stopDraftsAtom,
} from 'src/sections/views/store/view-session';
import { modeAtom, selectedDayAtom } from 'src/stores/ui-store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from 'src/app';
import { installMapResources } from './helpers/map-resources';
import { FakeMapAdapter } from 'src/components/map/FakeMapAdapter';
import { dayColor } from 'src/components/map/map-colors';
import { hashDayStops } from 'src/domain/day-hash';
import { overlay } from 'src/domain/overlay';
import { createMemoryStorage, storageKey } from 'src/repositories/edit-layer-repo';
import type { EditLayer } from 'src/schema/legacy/edit-layer';
import type { TripData } from 'src/schema/legacy/trip-data';
import { moveStop, reorderStops } from 'src/sections/itinerary/store/itinerary-actions';
import { DayTotals } from 'src/sections/itinerary/view/DayTotals';
import { LegRow } from 'src/sections/itinerary/view/LegRow';
import { createTripStore, TripStoreContext } from 'src/stores/trip-store';
import { makeEdit, makeTrip, sid } from '../../fixtures/builders';

const PID = 'testtrip0001';
const KEY = storageKey(PID);
const NOW_MS = 1759460000000;
const NOW = '2026-10-03T02:00:00.000Z';
const OLD = '2026-10-03T00:30:00.000Z';
const D1 = '2026-11-14';
const D2 = '2026-11-15';

const saved = (storage: Storage): EditLayer => JSON.parse(storage.getItem(KEY)!) as EditLayer;
const HINT = '재계산하려면 편집을 파일로 내보내 apply-edit을 실행하세요';

/** 방문 편집을 여는 상세 영역의 시험용 대역(옛 `DetailSurface`의 `stop` 분기만). */
function TestDetails() {
  const [detail, setDetail] = useAtom(detailAtom);
  const store = useStore();
  if (detail?.kind !== 'stop') return null;
  return (
    <Box role="dialog" aria-label="방문 편집">
      <IconButton aria-label="닫기" onClick={() => setDetail(null)}>
        ×
      </IconButton>
      <StopEditPanel
        date={detail.date}
        stopId={detail.stopId}
        onClose={() => {
          if (store.get(detailAtom) === detail) setDetail(null);
        }}
      />
    </Box>
  );
}

const MAP_PADDING = { top: 24, right: 24, bottom: 24, left: 24 };

/**
 * 옛 `TripPage`의 일정 모드를 줄인 시험용 화면: 일정 패널, 일정 지도(마커·폴리라인·후보 마커 클릭),
 * 방문 편집 상세. 지도는 compact처럼 "동선 지도 보기"를 눌러야 보인다.
 */
function ItineraryHost() {
  const day = useAtomValue(selectedDayAtom);
  const routeMapVisible = useAtomValue(mobileRouteMapAtom);
  const layers = useItineraryLayers();
  const onItineraryMarkerClick = useItineraryMarkerClick();
  const [, setUnavailable] = useState<string | null>(null);
  return (
    <>
      <ItineraryPanel />
      <MapView
        visible={routeMapVisible}
        padding={MAP_PADDING}
        markers={layers.markers}
        polylines={layers.polylines}
        onMarkerClick={(id) => {
          if (id.startsWith('candidate/')) onItineraryMarkerClick(id);
        }}
        fitKey={`itinerary:${day}`}
        onUnavailable={setUnavailable}
      />
      <TestDetails />
    </>
  );
}

function renderPage(trip: TripData, edit?: EditLayer, day: string = D1) {
  vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
  const storage = createMemoryStorage();
  if (edit) storage.setItem(KEY, JSON.stringify(edit));
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async () =>
        new Response(JSON.stringify(trip), { headers: { 'Content-Type': 'application/json' } }),
    );
  const store = createStore();
  store.set(modeAtom, 'itinerary');
  store.set(selectedDayAtom, day);
  render(
    <AppProviders>
      <LegacyTripScope
        publicId={PID}
        jotaiStore={store}
        deps={{ storage, fetchFn, now: () => NOW_MS, nowIso: () => NOW }}
      >
        <ItineraryHost />
      </LegacyTripScope>
    </AppProviders>,
  );
  return { storage, store };
}

/** dnd-kit이 측정·상태 갱신을 마치게 한 틱 기다린다. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));

const panel = () => screen.findByTestId('itinerary-panel');

let mapResources: ReturnType<typeof installMapResources>;

beforeEach(() => {
  mapResources = installMapResources();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  mapResources.restore();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('구간 행·Day 합계 문구', () => {
  const routed = {
    fromStopId: 'aaaa',
    toStopId: 'bbbb',
    fromPlaceKey: 'n:1',
    toPlaceKey: 'n:2',
    status: 'routed' as const,
    distanceM: 180_000,
    distanceKind: 'road' as const,
    durationMs: (2 * 60 + 31) * 60_000 + 59_000,
    staticDurationMs: null,
    tollFare: 8500,
    path: [],
    queriedAt: OLD,
  };

  it('계산된 구간: 🚗 {h}시간 {m}분 · 도로 {km}km · {원}원 (분 단위 내림)', () => {
    render(<LegRow leg={routed} />);
    expect(screen.getByText('🚗 2시간 31분 · 도로 180.0km · 8,500원')).toBeInTheDocument();
  });

  it('1시간 미만이면 {m}분만', () => {
    render(<LegRow leg={{ ...routed, durationMs: 600_000, distanceM: 1000, tollFare: 0 }} />);
    expect(screen.getByText('🚗 10분 · 도로 1.0km · 0원')).toBeInTheDocument();
  });

  it('미계산 구간: ┄ 직선 {km}km · 시간 미상 · 재계산 필요', () => {
    render(
      <LegRow
        leg={{
          ...routed,
          status: 'unrouted',
          distanceKind: 'straight',
          distanceM: 3210,
          durationMs: null,
          tollFare: null,
          queriedAt: null,
        }}
      />,
    );
    expect(screen.getByText('┄ 직선 3.2km · 시간 미상 · 재계산 필요')).toBeInTheDocument();
  });

  it('합계: 계산된 구간만 더하고 미계산 구간 수·직선거리를 함께', () => {
    render(
      <DayTotals
        totals={{
          durationMs: 160 * 60_000,
          roadDistanceM: 186_000,
          tollFare: 8500,
          uncomputedCount: 2,
          straightDistanceM: 5100,
        }}
      />,
    );
    expect(
      screen.getByText(
        '계산된 구간 2시간 40분 · 도로 186.0km · 8,500원 · 미계산 2구간(직선 5.1km)',
      ),
    ).toBeInTheDocument();
  });

  it('미계산 0이면 뒷부분 생략', () => {
    render(
      <DayTotals
        totals={{
          durationMs: 1_200_000,
          roadDistanceM: 2000,
          tollFare: 12345,
          uncomputedCount: 0,
          straightDistanceM: 0,
        }}
      />,
    );
    expect(screen.getByText('계산된 구간 20분 · 도로 2.0km · 12,345원')).toBeInTheDocument();
  });
});

describe('타임라인', () => {
  it('Day 탭: 전체 / Day 1 / Day 2', async () => {
    const trip = makeTrip({ days: { [D1]: ['A'], [D2]: ['B'] } });
    renderPage(trip);
    const tabs = within(await panel()).getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-label') ?? t.textContent)).toEqual([
      '전체',
      'Day 1',
      'Day 2',
    ]);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(tabs[2]!);
    expect(await within(await panel()).findAllByText('B')).toHaveLength(2);
  });

  it('Day 탭을 바꾸면 그날 마커로 한 번 fitBounds하고, 메모 편집은 다시 맞추지 않는다', async () => {
    const fit = vi.spyOn(FakeMapAdapter.prototype, 'fitBounds');
    const trip = makeTrip({ days: { [D1]: ['A', 'B'], [D2]: ['C', 'D'] } });
    renderPage(trip, makeEdit());
    await userEvent.click(await screen.findByRole('button', { name: '동선 지도 보기' }));
    await screen.findByTestId('marker-n:1');
    await waitFor(() => expect(fit).toHaveBeenCalled());
    const before = fit.mock.calls.length;
    const tabs = within(await panel()).getAllByRole('tab');
    await userEvent.click(tabs[2]!);
    await screen.findByTestId('marker-n:3');
    expect(fit).toHaveBeenCalledTimes(before + 1);
    const pt = (k: string): [number, number] => [trip.places[k]!.lng, trip.places[k]!.lat];
    expect(fit).toHaveBeenLastCalledWith([pt('n:3'), pt('n:4')], {
      top: 24,
      right: 24,
      bottom: 24,
      left: 24,
    });

    await userEvent.click(await screen.findByRole('button', { name: 'C 메뉴' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '시간·메모 편집' }));
    await userEvent.type(screen.getByLabelText('C 메모'), '새 메모');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('새 메모')).toBeInTheDocument();
    expect(fit).toHaveBeenCalledTimes(before + 1);
  });

  it('장소 행 사이에 구간 행, 합계 줄', async () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'B', 'C'] } });
    renderPage(trip);
    const p = await panel();
    expect(await within(p).findAllByText('🚗 10분 · 도로 1.0km · 0원')).toHaveLength(2);
    expect(within(p).getByText('계산된 구간 20분 · 도로 2.0km · 0원')).toBeInTheDocument();
  });

  it('키보드 드래그(Space→ArrowDown→Space) → reorderStops 반영, 구간 행이 미계산 문구로', async () => {
    // jsdom은 레이아웃이 없으므로 정렬 항목에 세로 위치를 준다.
    const original = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const index = (this as HTMLElement).dataset?.sortableIndex;
      if (index === undefined) return original.call(this);
      const top = Number(index) * 50;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        right: 300,
        bottom: top + 50,
        width: 300,
        height: 50,
        toJSON: () => ({}),
      } as DOMRect;
    });
    const trip = makeTrip({ days: { [D1]: ['A', 'B', 'C'] } });
    const { storage } = renderPage(trip, makeEdit());
    await userEvent.click(await screen.findByRole('button', { name: '일정 편집' }));
    const handle = await screen.findByRole('button', { name: 'A 순서 바꾸기' });
    act(() => handle.focus());
    fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
    await settle();
    fireEvent.keyDown(document.activeElement ?? handle, { code: 'ArrowDown', key: 'ArrowDown' });
    await settle();
    fireEvent.keyDown(document.activeElement ?? handle, { code: 'Space', key: ' ' });
    await settle();
    await waitFor(() => expect(saved(storage).days[D1]).toBeDefined());
    const day = saved(storage).days[D1]!;
    if (day.mode !== 'override') throw new Error('override 아님');
    expect(day.stops.map((s) => s.id)).toEqual([sid('B'), sid('A'), sid('C')]);
    expect(day.updatedAt).toBe(NOW);
    const p = await panel();
    await waitFor(() => expect(within(p).getAllByText(/^┄ 직선 .*재계산 필요$/)).toHaveLength(2));
    expect(within(p).queryByText(/^🚗/)).toBeNull();
  });

  it('⋯ 메뉴: 다른 날로 이동 → 같은 id로 도착일 끝, 두 날 updatedAt 같음', async () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'X'], [D2]: ['B'] } });
    const { storage } = renderPage(trip, makeEdit());
    await userEvent.click(await screen.findByRole('button', { name: 'X 메뉴' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Day 2 (11/15)로 이동' }));
    await waitFor(() => expect(saved(storage).days[D2]).toBeDefined());
    const eff = overlay(trip, saved(storage));
    expect(eff.days[1]!.stops.map((s) => s.id)).toEqual([sid('B'), sid('X')]);
    expect(eff.days[0]!.stops.map((s) => s.id)).toEqual([sid('A')]);
    expect(saved(storage).days[D1]!.updatedAt).toBe(NOW);
    expect(saved(storage).days[D2]!.updatedAt).toBe(NOW);
  });

  it('⋯ 메뉴: 빼기', async () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'B'] } });
    const { storage } = renderPage(trip, makeEdit());
    await userEvent.click(await screen.findByRole('button', { name: 'B 메뉴' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '빼기' }));
    await waitFor(() => expect(saved(storage).days[D1]).toBeDefined());
    expect(overlay(trip, saved(storage)).days[0]!.stops.map((s) => s.id)).toEqual([sid('A')]);
  });

  it('시간·메모 인라인 편집 → updateStop, 빈 값이면 필드 삭제', async () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'B'] } });
    trip.days[0]!.stops[1]!.note = '원래 메모';
    const { storage } = renderPage(trip, makeEdit());
    await userEvent.click(await screen.findByRole('button', { name: 'B 메뉴' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '시간·메모 편집' }));
    await userEvent.type(screen.getByLabelText('B 시간'), '09:30');
    const note = screen.getByLabelText('B 메모');
    expect(note).toHaveValue('원래 메모');
    await userEvent.clear(note);
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(saved(storage).days[D1]).toBeDefined());
    expect(overlay(trip, saved(storage)).days[0]!.stops[1]).toEqual({
      id: sid('B'),
      placeKey: 'n:2',
      time: '09:30',
    });
    expect(await screen.findByText('09:30')).toBeInTheDocument();
  });

  it('잘못된 시간 형식은 저장하지 않는다', async () => {
    const trip = makeTrip({ days: { [D1]: ['A'] } });
    const { storage } = renderPage(trip);
    await userEvent.click(await screen.findByRole('button', { name: 'A 메뉴' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '시간·메모 편집' }));
    await userEvent.type(screen.getByLabelText('A 시간'), '25:00');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('시간은 HH:mm 형식으로 입력하세요')).toBeInTheDocument();
    expect(storage.getItem(KEY)).toBeNull();
  });

  it('Review Focus 3: stop 0개 → "방문 없음", 합계 줄 없음 / 1개 → 구간 행 없음', async () => {
    const trip = makeTrip({ days: { [D1]: [], [D2]: ['A'] } });
    renderPage(trip);
    const p = await panel();
    expect(await within(p).findByText('방문 없음')).toBeInTheDocument();
    expect(within(p).queryByText(/^계산된 구간/)).toBeNull();
    await userEvent.click(within(p).getByRole('tab', { name: 'Day 2' }));
    expect(await within(p).findAllByText('A')).toHaveLength(2);
    expect(within(p).queryByText('방문 없음')).toBeNull();
    expect(within(p).queryByText(/^🚗|^┄/)).toBeNull();
    expect(within(p).queryByText(/^계산된 구간/)).toBeNull();
  });
});

describe('원본 일정으로 되돌리기', () => {
  it('이동 없는 날은 확인 없이 즉시 reset', async () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'B'], [D2]: ['C'] } });
    const edit = reorderStops(trip, makeEdit(), D1, sid('A'), 1, OLD);
    const { storage } = renderPage(trip, edit);
    await userEvent.click(await screen.findByRole('button', { name: '원본 일정으로 되돌리기' }));
    await waitFor(() => expect(saved(storage).days[D1]).toEqual({ mode: 'reset', updatedAt: NOW }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(saved(storage).days[D2]).toBeUndefined();
  });

  it('이동이 있으면 RevertDialog 문구 후 확인 시 두 날 reset', async () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'X'], [D2]: ['B'] } });
    const edit = moveStop(trip, makeEdit(), sid('X'), D1, D2, OLD);
    const { storage } = renderPage(trip, edit);
    await userEvent.click(await screen.findByRole('button', { name: '원본 일정으로 되돌리기' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        'Day 1의 방문이 Day 2로 옮겨져 있어 Day 1, Day 2를 함께 원본으로 되돌립니다. Day 2의 다른 편집도 함께 사라져요.',
      ),
    ).toBeInTheDocument();
    expect(saved(storage).days[D1]!.mode).toBe('override');
    await userEvent.click(within(dialog).getByRole('button', { name: '되돌리기' }));
    await waitFor(() =>
      expect(saved(storage).days).toEqual({
        [D1]: { mode: 'reset', updatedAt: NOW },
        [D2]: { mode: 'reset', updatedAt: NOW },
      }),
    );
  });

  it('대화상자에서 취소하면 그대로', async () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'X'], [D2]: ['B'] } });
    const edit = moveStop(trip, makeEdit(), sid('X'), D1, D2, OLD);
    const { storage } = renderPage(trip, edit);
    await userEvent.click(await screen.findByRole('button', { name: '원본 일정으로 되돌리기' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '취소' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(saved(storage)).toEqual(edit);
  });

  it('원본 그대로인 날에는 버튼이 없다', async () => {
    renderPage(makeTrip({ days: { [D1]: ['A', 'B'] } }));
    await within(await panel()).findAllByText('A');
    expect(screen.queryByRole('button', { name: '원본 일정으로 되돌리기' })).toBeNull();
  });
});

describe('작성자 안내', () => {
  it('미계산 구간이 있는 override가 있으면 패널 하단에 안내', async () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'B', 'C'] } });
    const edit = reorderStops(trip, makeEdit(), D1, sid('A'), 1, OLD);
    renderPage(trip, edit);
    const p = await panel();
    expect(await within(p).findByTestId('author-hint')).toHaveTextContent(HINT);
  });

  it('override여도 모든 구간이 계산돼 있으면 안내 없음', async () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'B', 'C'] } });
    const edit = makeEdit({
      days: {
        [D1]: {
          mode: 'override',
          stops: trip.days[0]!.stops.slice(0, 2),
          baseDayHash: hashDayStops(trip.days[0]!.stops),
          updatedAt: OLD,
        },
      },
    });
    renderPage(trip, edit);
    const p = await panel();
    await within(p).findAllByText('A');
    expect(within(p).queryByTestId('author-hint')).toBeNull();
  });
});

describe('일정 지도', () => {
  it('반복 방문 마커 라벨은 원문자 순번을 이어 붙인다(①⑥)', async () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'B', 'C', 'D', 'E', 'A2'] } });
    renderPage(trip);
    await userEvent.click(await screen.findByRole('button', { name: '동선 지도 보기' }));
    const marker = await screen.findByTestId('marker-n:1');
    expect(marker).toHaveTextContent('①⑥');
    expect(screen.getByTestId('marker-n:2')).toHaveTextContent('②');
    expect(screen.getByTestId('polyline-2026-11-14/0').dataset.color).toBe(dayColor(0));
  });

  it('후보 레이어: 일정에 없는 장소가 흐린 마커, 클릭 → 선택한 날 끝에 추가', async () => {
    const trip = makeTrip({ days: { [D1]: ['A'], [D2]: ['B'] }, places: ['P'] });
    const { storage } = renderPage(trip, makeEdit());
    await userEvent.click(await screen.findByRole('button', { name: '동선 지도 보기' }));
    await screen.findByTestId('marker-n:1');
    expect(screen.queryByTestId('marker-candidate/n:3')).toBeNull();
    await userEvent.click(screen.getByRole('switch', { name: '후보 장소 보기' }));
    const candidate = await screen.findByTestId('marker-candidate/n:3');
    expect(candidate.dataset.dimmed).toBe('true');
    expect(screen.queryByTestId('marker-candidate/n:2')).toBeNull();
    await userEvent.click(candidate);
    await waitFor(() => expect(saved(storage).days[D1]).toBeDefined());
    const day = saved(storage).days[D1]!;
    if (day.mode !== 'override') throw new Error('override 아님');
    expect(day.stops.map((s) => s.placeKey)).toEqual(['n:1', 'n:3']);
    expect(day.stops[1]!.id).toMatch(/^[a-z0-9]{4}$/);
    await waitFor(() => expect(screen.queryByTestId('marker-candidate/n:3')).toBeNull());
  });

  it('"전체" 탭: 모든 날 폴리라인이 dayColor(i), 미계산 구간은 dashed', async () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'B'], [D2]: ['C', 'D'] } });
    const edit = reorderStops(trip, makeEdit(), D2, sid('D'), 0, OLD);
    renderPage(trip, edit, 'all');
    await userEvent.click((await screen.findAllByRole('button', { name: '동선 지도 보기' }))[0]!);
    const l1 = await screen.findByTestId('polyline-2026-11-14/0');
    const l2 = screen.getByTestId('polyline-2026-11-15/0');
    expect(l1.dataset.color).toBe(dayColor(0));
    expect(l1.dataset.dashed).toBe('false');
    expect(l2.dataset.color).toBe(dayColor(1));
    expect(l2.dataset.dashed).toBe('true');
    expect(screen.getByTestId(`marker-${D1}/n:1`)).toHaveTextContent('①');
    expect(screen.getByTestId(`marker-${D2}/n:4`)).toHaveTextContent('①');
  });
});

function setupItineraryPiece(node: ReactNode, trip: TripData, edit = makeEdit()) {
  const storage = createMemoryStorage();
  storage.setItem(KEY, JSON.stringify(edit));
  const ts = createTripStore(PID, {
    storage,
    locks: undefined,
    now: () => NOW_MS,
    nowIso: () => NOW,
  });
  const store = createStore();
  store.set(ts.tripAtom, trip);
  store.set(ts.editLayerAtom, edit);
  store.set(selectedDayAtom, D1);
  render(
    <AppProviders>
      <TripStoreContext value={ts}>
        <Provider store={store}>
          {node}
          <TestDetails />
        </Provider>
      </TripStoreContext>
    </AppProviders>,
  );
  return { store, storage, ts };
}
function CompactTimelineHarness({ trip }: { trip: TripData }) {
  const days = useItineraryDays();
  return days[0] ? <Timeline trip={trip} item={days[0]} /> : null;
}
describe('compact 일정', () => {
  it('조회에는 손잡이가 없고 편집 모드에서만 나타난다', () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'B'] } });
    const { store } = setupItineraryPiece(<CompactTimelineHarness trip={trip} />, trip);
    expect(screen.queryByRole('button', { name: 'A 순서 바꾸기' })).toBeNull();
    act(() => store.set(itineraryEditingAtom, true));
    expect(screen.getByRole('button', { name: 'A 순서 바꾸기' })).toBeVisible();
  });
  it('메뉴 편집은 stop 초안과 공통 상세를 열고 기존 초안을 보존한다', async () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'A2'] } });
    const { store } = setupItineraryPiece(<CompactTimelineHarness trip={trip} />, trip);
    act(() => store.set(stopDraftsAtom, { a000: { date: D1, time: '09:00', note: '초안' } }));
    await userEvent.click(screen.getAllByRole('button', { name: 'A 메뉴' })[0]!);
    await userEvent.click(screen.getByRole('menuitem', { name: '시간·메모 편집' }));
    expect(store.get(detailAtom)).toEqual({ kind: 'stop', date: D1, stopId: 'a000' });
    expect(store.get(stopDraftsAtom).a000?.note).toBe('초안');
    await userEvent.click(screen.getAllByRole('button', { name: 'A 메뉴' })[1]!);
    await userEvent.click(screen.getByRole('menuitem', { name: '시간·메모 편집' }));
    expect(store.get(stopDraftsAtom).a200).toEqual({ date: D1, time: '', note: '' });
  });
  it('한 칸 아래로는 실제 저장 순서를 바꾸고 미계산 구간을 표시한다', async () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'B', 'C'] } });
    const { storage } = setupItineraryPiece(<CompactTimelineHarness trip={trip} />, trip);
    await userEvent.click(screen.getByRole('button', { name: 'A 메뉴' }));
    expect(screen.getByRole('menuitem', { name: '한 칸 위로' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(screen.getByRole('menuitem', { name: '한 칸 아래로' }));
    await waitFor(() =>
      expect(overlay(trip, saved(storage)).days[0]?.stops.map((s) => s.id)).toEqual([
        'b000',
        'a000',
        'c000',
      ]),
    );
    expect(screen.getAllByText(/시간 미상 · 재계산 필요/)).toHaveLength(2);
  });
  it('compact header 편집·지도 토글 및 날짜 전환은 초안을 유지한다', async () => {
    const trip = makeTrip({ days: { [D1]: ['A'], [D2]: [] } });
    const { store } = setupItineraryPiece(<ItineraryPanel />, trip);
    act(() => store.set(stopDraftsAtom, { a000: { date: D1, time: '', note: '초안' } }));
    await userEvent.click(screen.getByRole('button', { name: '일정 편집' }));
    expect(store.get(itineraryEditingAtom)).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '동선 지도 보기' }));
    expect(store.get(mobileRouteMapAtom)).toBe(true);
    expect(screen.getByRole('link', { name: '네이버에서 보기' })).toHaveAttribute(
      'href',
      'https://m.place.naver.com/place/1',
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Day 2' }));
    expect(store.get(itineraryEditingAtom)).toBe(false);
    expect(store.get(stopDraftsAtom).a000?.note).toBe('초안');
    expect(screen.getByText('방문 없음')).toBeVisible();
    expect(screen.queryByText('첫 번째 방문')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: '전체' }));
    expect(screen.queryByText('첫 번째 방문')).toBeNull();
  });
});

describe('compact 저장 회귀', () => {
  it('편집 모드의 키보드 정렬은 기존 dnd-kit과 reorderStops로 저장한다', async () => {
    const original = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const index = (this as HTMLElement).dataset?.sortableIndex;
      if (index === undefined) return original.call(this);
      const top = Number(index) * 50;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        right: 300,
        bottom: top + 50,
        width: 300,
        height: 50,
        toJSON: () => ({}),
      } as DOMRect;
    });
    const trip = makeTrip({ days: { [D1]: ['A', 'B', 'C'] } });
    const { store, storage } = setupItineraryPiece(<CompactTimelineHarness trip={trip} />, trip);
    act(() => store.set(itineraryEditingAtom, true));
    const handle = screen.getByRole('button', { name: 'A 순서 바꾸기' });
    act(() => handle.focus());
    fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
    await settle();
    fireEvent.keyDown(document.activeElement ?? handle, { code: 'ArrowDown', key: 'ArrowDown' });
    await settle();
    fireEvent.keyDown(document.activeElement ?? handle, { code: 'Space', key: ' ' });
    await settle();
    await waitFor(() =>
      expect(overlay(trip, saved(storage)).days[0]?.stops.map((s) => s.id)).toEqual([
        'b000',
        'a000',
        'c000',
      ]),
    );
    expect(screen.getAllByText(/시간 미상 · 재계산 필요/)).toHaveLength(2);
  });
  it('다른 날에 50곳이면 이동을 거부하고 기존 저장을 유지한다', async () => {
    const trip = makeTrip({
      days: { [D1]: ['A'], [D2]: Array.from({ length: 50 }, (_, i) => `B${i + 1}`) },
    });
    const { storage } = setupItineraryPiece(<CompactTimelineHarness trip={trip} />, trip);
    const before = storage.getItem(KEY);
    await userEvent.click(screen.getByRole('button', { name: 'A 메뉴' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Day 2 (11/15)로 이동' }));
    await screen.findByText('하루에 50곳까지 넣을 수 있어요');
    expect(storage.getItem(KEY)).toBe(before);
  });
  it('다른 날 이동으로 연결된 원본 그룹을 모두 되돌린다', async () => {
    const trip = makeTrip({ days: { [D1]: ['A', 'X'], [D2]: ['B'] } });
    const edit = moveStop(trip, makeEdit(), 'x000', D1, D2, OLD);
    const { storage } = setupItineraryPiece(<ItineraryPanel />, trip, edit);
    await userEvent.click(screen.getByRole('button', { name: '원본 일정으로 되돌리기' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /^되돌리기$/ }));
    await waitFor(() =>
      expect(overlay(trip, saved(storage)).days.map((d) => d.stops.map((s) => s.id))).toEqual([
        ['a000', 'x000'],
        ['b000'],
      ]),
    );
  });
});

it.each(['메뉴', '다른 탭'])(
  '%s로 옮긴 방문은 닫기에서 초안을 보존하고 명시적으로 버린 뒤 현재 날짜에 저장한다',
  async (method) => {
    const trip = makeTrip({ days: { [D1]: ['A', 'B'], [D2]: [] } });
    trip.days[0]!.stops[0]!.time = '08:30';
    trip.days[0]!.stops[0]!.note = '현재 방문 메모';
    const h = setupItineraryPiece(<ItineraryPanel />, trip);
    act(() =>
      h.store.set(stopDraftsAtom, { b000: { date: D1, time: '11:00', note: '다른 초안' } }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'A 메뉴' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '시간·메모 편집' }));
    fireEvent.change(screen.getByLabelText('A 메모'), { target: { value: '옛 날짜 초안' } });
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    if (method === '메뉴') {
      await userEvent.click(screen.getByRole('button', { name: 'A 메뉴' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Day 2 (11/15)로 이동' }));
      await waitFor(() =>
        expect(h.store.get(h.ts.effectiveTripAtom)!.days[1]!.stops).toHaveLength(1),
      );
    } else {
      h.storage.setItem(KEY, JSON.stringify(moveStop(trip, makeEdit(), 'a000', D1, D2, NOW)));
      act(() => window.dispatchEvent(new StorageEvent('storage', { key: KEY })));
    }
    await userEvent.click(screen.getByRole('tab', { name: 'Day 2' }));
    const open = async () => {
      await userEvent.click(screen.getByRole('button', { name: 'A 메뉴' }));
      await userEvent.click(screen.getByRole('menuitem', { name: '시간·메모 편집' }));
    };
    await open();
    expect(screen.getByText('방문 정보가 변경됐어요. 다시 선택하세요')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '돌아가기' }));
    expect(h.store.get(stopDraftsAtom).a000?.note).toBe('옛 날짜 초안');
    await open();
    await userEvent.click(screen.getByRole('button', { name: '초안 버리고 다시 편집' }));
    expect(screen.getByLabelText('A 시간')).toHaveValue('08:30');
    expect(screen.getByLabelText('A 메모')).toHaveValue('현재 방문 메모');
    expect(h.store.get(stopDraftsAtom).a000).toEqual({
      date: D2,
      time: '08:30',
      note: '현재 방문 메모',
    });
    expect(h.store.get(stopDraftsAtom).b000?.note).toBe('다른 초안');
    fireEvent.change(screen.getByLabelText('A 메모'), { target: { value: '새 날짜 저장' } });
    await userEvent.click(screen.getByRole('button', { name: /^저장$/ }));
    await waitFor(() => expect(h.store.get(detailAtom)).toBeNull());
    expect(overlay(trip, saved(h.storage)).days[1]!.stops[0]).toMatchObject({
      id: 'a000',
      note: '새 날짜 저장',
    });
    expect(h.store.get(stopDraftsAtom).b000?.note).toBe('다른 초안');
  },
);
