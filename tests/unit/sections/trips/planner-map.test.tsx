import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dayColor, NO_CATEGORY_COLOR } from 'src/components/map/map-colors';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import type { RouteResult } from 'src/server/route';
import { libraryAtom } from 'src/stores/library-state';
import { mapCardAtom } from 'src/stores/trip-planner';
import { installMapResources } from '../../components/helpers/map-resources';
import { makePlace, T0 } from '../library/fixtures';
import {
  at,
  f,
  fakeRoutes,
  HOUSE,
  makeTrip,
  open,
  P1,
  P2,
  P3,
  P5,
  plannerLibrary,
  route,
  stopRow,
  timeline,
  TRIP,
  withTrip,
} from './planner-fixtures';

const toastMock = vi.hoisted(() => {
  const error = vi.fn();
  return Object.assign(vi.fn(), { error });
});
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

let resources: ReturnType<typeof installMapResources>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 13, 12, 0, 0));
  vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
  resources = installMapResources();
});
afterEach(() => {
  toastMock.mockClear();
  toastMock.error.mockClear();
  resources.restore();
  setAppRuntimeForTest(null);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const HOTEL = 'place00007'; // 파도 호텔

/** 계획 화면 라이브러리 + 숙소로 쓸 호텔 하나. 속초 횟집에는 분류를 붙인다. */
function mapLibrary(): Library {
  const base = plannerLibrary();
  const hotel = at(makePlace(7, { name: '파도 호텔' }), 128.92, 37.77);
  const sokcho = { ...base.places[P3]!, category: f<string | null>('횟집') };
  return { ...base, places: { ...base.places, [HOTEL]: hotel, [P3]: sokcho } };
}

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};
const marker = (id: string) => screen.getByTestId(`marker-${id}`);
const markerChip = (id: string) => marker(id).firstElementChild as HTMLElement;
const polyline = (key: string) => screen.queryByTestId(`polyline-${key}`);
const fakeAdapter = () => [...resources.liveInstances][0]!;
const card = (name: string) => screen.getByRole('dialog', { name });
const days = (store: Awaited<ReturnType<typeof open>>['store']) =>
  store.get(libraryAtom).trips[TRIP]!.days;

async function mapReady() {
  await waitFor(() => expect(screen.getByTestId('fake-map')).toBeInTheDocument());
  await waitFor(() => expect(screen.queryAllByTestId(/^marker-/).length).toBeGreaterThan(0));
}

function walkingPath(): RouteResult {
  return {
    ...route(6, 450, { mode: 'walk', toll: null }),
    path: [
      [128.9, 37.75],
      [128.902, 37.751],
      [128.905, 37.75],
    ],
  };
}

describe('지도 마커와 경로선', () => {
  it('고른 Day는 번호·Day 색, 출발지·숙소는 집·침대, 후보는 회색, 다른 Day는 흐리게', async () => {
    const lib = withTrip(
      mapLibrary(),
      makeTrip({
        origin: HOUSE,
        stops: [[P1, P5], [P2]],
        candidates: [P3],
        lodging: [HOTEL],
      }),
    );
    await open(lib);
    await mapReady();

    expect(marker(P1)).toHaveTextContent('1 중앙시장 닭강정');
    expect(marker(P5)).toHaveTextContent('2 창가 자리');
    expect(markerChip(P1).style.background).toBe(rgb(dayColor(0)));
    expect(marker(`start:${HOUSE}`)).toHaveTextContent('🏠 바다 숙소');
    expect(markerChip(`start:${HOUSE}`).style.background).toBe(rgb(dayColor(0)));
    expect(markerChip(`start:${HOUSE}`).style.border).toContain('rgb(0, 0, 0)');
    expect(marker(`end:${HOTEL}`)).toHaveTextContent('🛏 파도 호텔');
    expect(marker(P3)).toHaveTextContent('속초 횟집');
    expect(markerChip(P3).style.background).toBe(rgb(NO_CATEGORY_COLOR));
    expect(marker(P2)).toHaveAttribute('data-dimmed', 'true');
    expect(marker(P1)).not.toHaveAttribute('data-dimmed');
  });

  it('구간마다 경로선 하나, 도보는 점선, 경로가 없으면 두 점 직선, 같은 지점은 선이 없다', async () => {
    const routes = fakeRoutes((call) => (call.mode === 'walk' ? walkingPath() : route(12, 1100)));
    // 출발지 = 첫 장소(같은 지점), 닭강정 → 창가 자리(도보), 창가 자리 → 카페거리(자동차).
    const lib = withTrip(mapLibrary(), makeTrip({ origin: P1, stops: [[P1, P5, P2]] }));
    await open(lib, { routes });
    await mapReady();

    await waitFor(() => expect(polyline(`${P1}>${P5}`)).toHaveAttribute('data-points', '3'));
    expect(polyline(`${P1}>${P5}`)).toHaveAttribute('data-dashed', 'true');
    expect(polyline(`${P1}>${P5}`)).toHaveAttribute('data-color', dayColor(0));
    expect(polyline(`${P5}>${P2}`)).toHaveAttribute('data-dashed', 'false');
    expect(polyline(`${P1}>${P1}`)).toBeNull();
    expect(screen.getAllByTestId(/^polyline-/)).toHaveLength(2);
  });

  it('오프라인이면 경로선은 두 점 직선이다', async () => {
    await open(withTrip(mapLibrary(), makeTrip({ stops: [[P1, P2]] })));
    await mapReady();
    await waitFor(() => expect(polyline(`${P1}>${P2}`)).toHaveAttribute('data-points', '2'));
  });

  it('Day 탭을 바꾸면 그 Day의 장소·출발점·숙소에만 지도를 다시 맞춘다(후보는 빼고)', async () => {
    const lib = withTrip(
      mapLibrary(),
      makeTrip({ stops: [[P1, P5], [P3]], candidates: [P2], lodging: [HOTEL] }),
    );
    await open(lib);
    await mapReady();
    await waitFor(() => expect(fakeAdapter().fitCalls.length).toBeGreaterThan(0));
    expect(fakeAdapter().fitCalls.at(-1)).toEqual([
      [128.9, 37.75],
      [128.905, 37.75],
      [128.92, 37.77],
    ]);
    const before = fakeAdapter().fitCalls.length;
    const user = userEvent.setup();

    await user.click(screen.getByRole('tab', { name: 'Day 2 10.24(토)' }));
    await waitFor(() => expect(marker(P3)).toHaveTextContent('1 속초 횟집'));
    await waitFor(() => expect(fakeAdapter().fitCalls.length).toBe(before + 1));
    // Day 2: 출발점(전날 숙소)과 속초 횟집.
    expect(fakeAdapter().fitCalls.at(-1)).toEqual([
      [128.59, 38.2],
      [128.92, 37.77],
    ]);
    expect(marker(P1)).toHaveAttribute('data-dimmed', 'true');
  });

  it('장소가 없는 Day는 후보에 맞춘다', async () => {
    await open(withTrip(mapLibrary(), makeTrip({ candidates: [P1, P2] })));
    await mapReady();
    await waitFor(() =>
      expect(fakeAdapter().fitCalls.at(-1)).toEqual([
        [128.9, 37.75],
        [128.947, 37.772],
      ]),
    );
  });
});

describe('지도 위 카드', () => {
  it('회색 핀을 누르면 후보 카드, Day 1에 넣기를 누르면 번호 마커로 바뀐다', async () => {
    const lib = withTrip(mapLibrary(), makeTrip({ stops: [[P1, P5]], candidates: [P3] }));
    const { store } = await open(lib, { ids: ['stopaaaa'] });
    await mapReady();
    const user = userEvent.setup();

    await user.click(marker(P3));
    const dialog = card('속초 횟집');
    expect(within(dialog).getByText('횟집')).toBeInTheDocument();
    expect(within(dialog).getByText('후보')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('체류 시간(분)')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Day 1에 넣기' }));
    await waitFor(() =>
      expect(days(store)[0]!.stops.value.map((s) => s.placeId)).toEqual([P1, P5, P3]),
    );
    await waitFor(() => expect(marker(P3)).toHaveTextContent('3 속초 횟집'));
    expect(within(card('속초 횟집')).getByText('Day 1 · 3번째')).toBeInTheDocument();
    expect(within(card('속초 횟집')).getByLabelText('체류 시간(분)')).toBeInTheDocument();
  });

  it('시간표 행·후보 행을 눌러도 카드가 열리고, 카드는 한 번에 하나다', async () => {
    const lib = withTrip(mapLibrary(), makeTrip({ stops: [[P1, P5]], candidates: [P3] }));
    await open(lib);
    await mapReady();
    const user = userEvent.setup();

    // 행 본문(시각·이름) 버튼. 손잡이(…끌어 옮기기)·행 메뉴(…메뉴)와 구분한다.
    await user.click(within(timeline()).getByRole('button', { name: /^\S*창가 자리$/ }));
    expect(within(card('창가 자리')).getByText('Day 1 · 2번째')).toBeInTheDocument();

    const panel = screen.getByRole('region', { name: '후보 칸' });
    // 행 본문(이름·지역) 버튼. `＋`(…에 넣기)와 구분한다.
    await user.click(within(panel).getByRole('button', { name: /^속초 횟집\s*속초$/ }));
    expect(card('속초 횟집')).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(marker(P3)).toHaveAttribute('aria-pressed', 'true');
  });

  it('Esc나 카드 밖을 누르면 닫힌다', async () => {
    const lib = withTrip(mapLibrary(), makeTrip({ stops: [[P1, P5]] }));
    await open(lib);
    await mapReady();
    const user = userEvent.setup();

    await user.click(marker(P1));
    expect(card('중앙시장 닭강정')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(marker(P1));
    expect(card('중앙시장 닭강정')).toBeInTheDocument();
    await user.click(within(timeline()).getByLabelText('출발 시각'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('체류 시간을 넣으면 시간표의 도착 시각이 바뀐다', async () => {
    const routes = fakeRoutes(() => route(10, 1000));
    const lib = withTrip(mapLibrary(), makeTrip({ stops: [[P1, P2]] }));
    const { store } = await open(lib, { routes });
    await mapReady();
    const user = userEvent.setup();
    expect(await within(stopRow('안목 카페거리')).findByText('09:10')).toBeInTheDocument();

    await user.click(marker(P1));
    const stay = within(card('중앙시장 닭강정')).getByLabelText('체류 시간(분)');
    await user.clear(stay);
    await user.type(stay, '45{Enter}');
    await waitFor(() => expect(days(store)[0]!.stops.value[0]!.stayMin).toBe(45));
    expect(within(stopRow('안목 카페거리')).getByText('09:55')).toBeInTheDocument();
    expect(within(stopRow('중앙시장 닭강정')).getByText('체류 45분')).toBeInTheDocument();

    // 범위를 넘으면 1440분으로 맞춘다.
    await user.clear(stay);
    await user.type(stay, '5000');
    await user.tab();
    await waitFor(() => expect(days(store)[0]!.stops.value[0]!.stayMin).toBe(1440));
  });

  it('체류 시간을 입력한 채 다른 핀을 누르거나 지도를 눌러 카드가 닫혀도 저장한다', async () => {
    const lib = withTrip(mapLibrary(), makeTrip({ stops: [[P1, P2]] }));
    const { store } = await open(lib);
    await mapReady();
    const user = userEvent.setup();

    await user.click(marker(P1));
    await user.type(within(card('중앙시장 닭강정')).getByLabelText('체류 시간(분)'), '30');
    await user.click(marker(P2));
    expect(card('안목 카페거리')).toBeInTheDocument();
    await waitFor(() => expect(days(store)[0]!.stops.value[0]!.stayMin).toBe(30));

    await user.type(within(card('안목 카페거리')).getByLabelText('체류 시간(분)'), '20');
    await user.click(screen.getByTestId('fake-map'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(days(store)[0]!.stops.value[1]!.stayMin).toBe(20));

    // 입력란에서 Esc는 입력을 버리고 카드를 닫는다.
    await user.click(marker(P1));
    const stay = within(card('중앙시장 닭강정')).getByLabelText('체류 시간(분)');
    await user.clear(stay);
    await user.type(stay, '90');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(days(store)[0]!.stops.value[0]!.stayMin).toBe(30);
  });

  it('카드의 장소가 지워지거나 여행에서 빠지면 카드를 닫는다', async () => {
    const lib = withTrip(mapLibrary(), makeTrip({ stops: [[P1, P2]] }));
    const { store } = await open(lib);
    await mapReady();
    const user = userEvent.setup();

    await user.click(marker(P1));
    expect(card('중앙시장 닭강정')).toBeInTheDocument();
    act(() => {
      const current = store.get(libraryAtom);
      const place = current.places[P1]!;
      store.set(libraryAtom, {
        ...current,
        places: { ...current.places, [P1]: { ...place, deletedAt: T0 } },
      });
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(store.get(mapCardAtom)).toBeNull();

    await user.click(marker(P2));
    expect(card('안목 카페거리')).toBeInTheDocument();
    act(() => {
      const current = store.get(libraryAtom);
      const trip = current.trips[TRIP]!;
      const days = trip.days.map((d, i) => (i === 0 ? { ...d, stops: f([]) } : d));
      store.set(libraryAtom, { ...current, trips: { [TRIP]: { ...trip, days } } });
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(store.get(mapCardAtom)).toBeNull();
  });

  it('고정 시각을 넣으면 여유·늦음을 보이고, 지우면 고정을 푼다', async () => {
    const routes = fakeRoutes(() => route(10, 1000));
    const lib = withTrip(mapLibrary(), makeTrip({ stops: [[P1, P2]] }));
    const { store } = await open(lib, { routes });
    await mapReady();
    const user = userEvent.setup();
    expect(await within(stopRow('안목 카페거리')).findByText('09:10')).toBeInTheDocument();

    await user.click(marker(P2));
    const fixed = within(card('안목 카페거리')).getByLabelText('고정 시각');
    fireEvent.change(fixed, { target: { value: '09:30' } });
    expect(await within(stopRow('안목 카페거리')).findByText('여유 20분')).toBeInTheDocument();
    fireEvent.change(fixed, { target: { value: '09:05' } });
    expect(await within(stopRow('안목 카페거리')).findByText('늦음 5분')).toBeInTheDocument();
    fireEvent.change(fixed, { target: { value: '' } });
    await waitFor(() => expect(days(store)[0]!.stops.value[1]!.fixedTime).toBeNull());
    expect(within(stopRow('안목 카페거리')).queryByText(/고정$/)).not.toBeInTheDocument();
  });

  it('다른 Day로: 다른 Day 목록에서 고르면 그 Day 끝으로 옮긴다', async () => {
    const lib = withTrip(mapLibrary(), makeTrip({ days: 3, stops: [[P1, P5], [P2]] }));
    const { store } = await open(lib);
    await mapReady();
    const user = userEvent.setup();

    await user.click(marker(P1));
    await user.click(within(card('중앙시장 닭강정')).getByRole('button', { name: '다른 Day로' }));
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(items).toEqual(['Day 2 10.24(토)', 'Day 3 10.25(일)']);
    await user.click(screen.getByRole('menuitem', { name: 'Day 2 10.24(토)' }));

    await waitFor(() =>
      expect(days(store)[1]!.stops.value.map((s) => s.placeId)).toEqual([P2, P1]),
    );
    expect(days(store)[0]!.stops.value.map((s) => s.placeId)).toEqual([P5]);
    expect(within(card('중앙시장 닭강정')).getByText('Day 2 · 2번째')).toBeInTheDocument();
    await waitFor(() => expect(marker(P1)).toHaveAttribute('data-dimmed', 'true'));
    expect(marker(P5)).toHaveTextContent('1 창가 자리');
  });

  it('후보로 빼기: Day에서 빠져 후보 끝으로 가고 회색 핀이 된다', async () => {
    const lib = withTrip(mapLibrary(), makeTrip({ stops: [[P1, P5]], candidates: [P3] }));
    const { store } = await open(lib);
    await mapReady();
    const user = userEvent.setup();

    await user.click(marker(P1));
    await user.click(within(card('중앙시장 닭강정')).getByRole('button', { name: '후보로 빼기' }));
    await waitFor(() =>
      expect(store.get(libraryAtom).trips[TRIP]!.candidates.value).toEqual([P3, P1]),
    );
    expect(days(store)[0]!.stops.value.map((s) => s.placeId)).toEqual([P5]);
    await waitFor(() => expect(marker(P1)).toHaveTextContent(/^중앙시장 닭강정$/));
    expect(markerChip(P1).style.background).toBe(rgb(NO_CATEGORY_COLOR));
    expect(within(card('중앙시장 닭강정')).getByText('후보')).toBeInTheDocument();
  });

  it('숙소로 정하기: 고른 Day의 숙소가 되고 침대 핀이 생긴다', async () => {
    const lib = withTrip(mapLibrary(), makeTrip({ stops: [[], [P1]], candidates: [HOTEL] }));
    const { store } = await open(lib);
    await mapReady();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Day 2 10.24(토)' }));

    await user.click(marker(HOTEL));
    await user.click(within(card('파도 호텔')).getByRole('button', { name: '숙소로 정하기' }));
    await waitFor(() => expect(days(store).map((d) => d.lodging.value)).toEqual([null, HOTEL]));
    await waitFor(() => expect(marker(`end:${HOTEL}`)).toHaveTextContent('🛏 파도 호텔'));
    expect(within(card('파도 호텔')).getByRole('button', { name: '숙소로 정하기' })).toBeDisabled();

    // 되돌리기 토스트로 이전 숙소(없음)로 돌아간다.
    const call = toastMock.mock.calls.findLast((c) => c[0] === '숙소를 정했어요');
    const options = call![1] as { action: { label: string; onClick(): void } };
    expect(options.action.label).toBe('되돌리기');
    await act(async () => {
      options.action.onClick();
    });
    await waitFor(() => expect(days(store).map((d) => d.lodging.value)).toEqual([null, null]));
  });

  it('상세는 시간표 칸 자리에 장소 상세를 열고, ← 일정으로 돌아온다', async () => {
    const lib = withTrip(mapLibrary(), makeTrip({ stops: [[P1, P5]] }));
    await open(lib);
    await mapReady();
    const user = userEvent.setup();

    await user.click(marker(P5));
    await user.click(within(card('창가 자리')).getByRole('button', { name: '상세' }));
    const detail = screen.getByRole('region', { name: '장소 상세' });
    expect(within(detail).getByText('비밀 메모: 창가 자리가 좋아요')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Day 시간표' })).not.toBeInTheDocument();

    await user.click(within(detail).getByRole('button', { name: '← 일정으로' }));
    expect(timeline()).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '장소 상세' })).not.toBeInTheDocument();
  });
});

describe('좁은 화면', () => {
  it('카드를 열면 시트를 접고, 후보 탭에서도 경로를 요청하며 오프라인 안내는 한 번 보인다', async () => {
    const lib = withTrip(mapLibrary(), makeTrip({ stops: [[P1, P2]], candidates: [P3] }));
    await open(lib, { width: 375 });
    await mapReady();
    const user = userEvent.setup();
    const sheet = screen.getByRole('region', { name: '일정 시트' });
    expect(within(sheet).getByRole('tab', { name: '후보 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // 시간표 탭을 열지 않아도 고른 Day의 구간을 묻는다(기본 하네스는 늘 OFFLINE).
    const notice = '인터넷에 연결되지 않아 이동 시간은 어림값이에요';
    expect(await screen.findByText(notice)).toBeInTheDocument();
    await user.click(within(sheet).getByRole('tab', { name: 'Day 1' }));
    expect(screen.getAllByText(notice)).toHaveLength(1);

    expect(sheet).toHaveAttribute('data-snap', 'half');
    await user.click(marker(P3));
    expect(card('속초 횟집')).toBeInTheDocument();
    expect(sheet).toHaveAttribute('data-snap', 'collapsed');
  });

  it('시간표 칸 대신 상세를 시트 자리에 열고 ← 일정으로 돌아온다', async () => {
    const lib = withTrip(mapLibrary(), makeTrip({ stops: [[P1]] }));
    await open(lib, { width: 375 });
    await mapReady();
    const user = userEvent.setup();

    await user.click(marker(P1));
    await user.click(within(card('중앙시장 닭강정')).getByRole('button', { name: '상세' }));
    const detail = screen.getByRole('region', { name: '장소 상세' });
    await user.click(within(detail).getByRole('button', { name: '← 일정으로' }));
    expect(screen.queryByRole('region', { name: '장소 상세' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '일정 시트' })).toBeInTheDocument();
  });
});
