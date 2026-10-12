import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { Library, Place } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';
import type { RouteResult } from 'src/server/route';
import { RouteLookupError, type RouteLookupErrorCode } from 'src/services/errors';
import { RouteLookup } from 'src/services/route-lookup';
import { libraryAtom } from 'src/stores/library-state';
import { makePlace, renderLibrary, sampleLibrary, T0, withPlaces } from '../library/fixtures';

const toastMock = vi.hoisted(() => {
  const error = vi.fn();
  return Object.assign(vi.fn(), { error });
});
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 13, 12, 0, 0));
});
afterEach(() => {
  toastMock.mockClear();
  toastMock.error.mockClear();
  setAppRuntimeForTest(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const f = <V,>(value: V) => ({ value, updatedAt: T0 });

// ---------- 장소 ----------
// fixtures의 장소는 모두 같은 좌표라서, 구간이 생기도록 좌표를 따로 준다.

const at = (place: Place, lng: number, lat: number): Place => ({ ...place, lng, lat });

const P1 = 'place00001'; // 중앙시장 닭강정
const P2 = 'place00002'; // 안목 카페거리 — P1에서 약 4.8km(자동 자동차)
const P3 = 'place00003'; // 속초 횟집 — P2에서 50km 넘게(도보 불가)
const P5 = 'place00005'; // 창가 자리 — P1에서 약 440m(자동 도보)
const HOUSE = 'place00006'; // 바다 숙소
const GONE = 'place00009'; // 보관함에서 지운 곳

const NAMES: Record<string, string> = {
  '128.9,37.75': '중앙시장 닭강정',
  '128.947,37.772': '안목 카페거리',
  '128.59,38.2': '속초 횟집',
  '128.905,37.75': '창가 자리',
  '128.93,37.76': '바다 숙소',
};

function plannerLibrary(): Library {
  const base = sampleLibrary();
  return withPlaces(base, [
    at(base.places[P1]!, 128.9, 37.75),
    at(base.places[P2]!, 128.947, 37.772),
    at(base.places[P3]!, 128.59, 38.2),
    at(base.places[P5]!, 128.905, 37.75),
    at(makePlace(6, { name: '바다 숙소' }), 128.93, 37.76),
    at(makePlace(9, { name: '지운 가게', deletedAt: T0 }), 128.91, 37.75),
  ]);
}

// ---------- 여행 ----------

const TRIP = 'trip000001';

function makeTrip(
  options: {
    start?: string;
    days?: number;
    stops?: string[][];
    candidates?: string[];
    origin?: string | null;
    lodging?: (string | null)[];
    legModes?: Record<string, 'car' | 'walk'>;
  } = {},
): Trip {
  const start = options.start ?? '2026-10-23';
  const count = options.days ?? 2;
  const endDate = new Date(Date.parse(`${start}T00:00:00Z`) + (count - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  let stopSeq = 0;
  return {
    id: TRIP,
    title: f('강릉 여행'),
    startDate: f(start),
    endDate: f(endDate),
    origin: f<string | null>(options.origin ?? null),
    candidates: f(options.candidates ?? []),
    days: Array.from({ length: count }, (_, i) => ({
      stops: f(
        (options.stops?.[i] ?? []).map((placeId) => ({
          id: `stop${String(stopSeq++).padStart(4, '0')}`,
          placeId,
          stayMin: null,
          fixedTime: null,
          note: '',
        })),
      ),
      lodging: f<string | null>(options.lodging?.[i] ?? null),
      startTime: f('09:00'),
    })),
    legModes: f(options.legModes ?? {}),
    createdAt: T0,
    deletedAt: null,
  };
}

const withTrip = (lib: Library, trip: Trip): Library => ({ ...lib, trips: { [trip.id]: trip } });

// ---------- 가짜 경로 조회 ----------

type Call = { mode: 'car' | 'walk'; from: string; to: string; refresh: boolean };
type Answer = RouteResult | RouteLookupErrorCode;

const nameAt = ([lng, lat]: [number, number]) => NAMES[`${lng},${lat}`] ?? `${lng},${lat}`;

function route(
  minutes: number,
  meters: number,
  options: { toll?: number | null; queriedAt?: string; mode?: 'car' | 'walk' } = {},
): RouteResult {
  return {
    mode: options.mode ?? 'car',
    distanceM: meters,
    durationS: minutes * 60,
    tollFare: options.toll === undefined ? 0 : options.toll,
    path: [
      [128.9, 37.75],
      [128.947, 37.772],
    ],
    queriedAt: options.queriedAt ?? '2026-10-12T03:00:00.000Z',
  };
}

/** 구간을 출발·도착 이름으로 받아 답하는 가짜. 부른 기록을 남긴다. */
function fakeRoutes(answer: (call: Call, nth: number) => Answer) {
  const calls: Call[] = [];
  const layer = Layer.succeed(
    RouteLookup,
    RouteLookup.of({
      leg: (mode, from, to, options) =>
        Effect.suspend(() => {
          const call = {
            mode,
            from: nameAt(from),
            to: nameAt(to),
            refresh: options?.refresh === true,
          };
          calls.push(call);
          const nth = calls.filter((c) => c.from === call.from && c.to === call.to).length;
          const out = answer(call, nth);
          return typeof out === 'string'
            ? Effect.fail(new RouteLookupError({ code: out }))
            : Effect.succeed(out);
        }),
    }),
  );
  return { layer, calls };
}

const legRow = (from: string, to: string) =>
  screen.getByRole('listitem', { name: `${from} → ${to}` });
const timeline = () => screen.getByRole('region', { name: 'Day 시간표' });
const stopRow = (name: string) => within(timeline()).getByText(name).closest('li')!;

async function open(
  lib: Library,
  options: {
    routes?: ReturnType<typeof fakeRoutes>;
    width?: number;
    ids?: string[];
    path?: string;
  } = {},
) {
  return renderLibrary(lib, {
    path: options.path ?? `/trips/${TRIP}`,
    width: options.width,
    ids: options.ids,
    routeLookup: options.routes?.layer,
  });
}

// ---------- 테스트 ----------

describe('후보 칸', () => {
  it('＋를 누르면 지금 Day 끝에 들어가고 시간표에 도착 시각이 보인다', async () => {
    const routes = fakeRoutes(() => route(12, 1100));
    const lib = withTrip(plannerLibrary(), makeTrip({ candidates: [P1, P2] }));
    const { store } = await open(lib, { routes, ids: ['stopaaaa', 'stopbbbb'] });
    const user = userEvent.setup();

    const panel = screen.getByRole('region', { name: '후보 칸' });
    expect(within(panel).getByText('강릉 여행')).toBeInTheDocument();
    expect(within(panel).getByText('후보 2')).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: '중앙시장 닭강정을 Day 1에 넣기' }));
    await waitFor(() =>
      expect(
        store.get(libraryAtom).trips[TRIP]!.days[0]!.stops.value.map((s) => s.placeId),
      ).toEqual([P1]),
    );
    expect(within(stopRow('중앙시장 닭강정')).getByText('09:00')).toBeInTheDocument();
    expect(store.get(libraryAtom).trips[TRIP]!.candidates.value).toEqual([P2]);

    // 받침이 없는 이름은 `를`.
    await user.click(screen.getByRole('button', { name: '안목 카페거리를 Day 1에 넣기' }));
    await waitFor(() =>
      expect(
        store.get(libraryAtom).trips[TRIP]!.days[0]!.stops.value.map((s) => s.placeId),
      ).toEqual([P1, P2]),
    );
    expect(await within(stopRow('안목 카페거리')).findByText('09:12')).toBeInTheDocument();
    expect(within(panel).getByText('후보 0')).toBeInTheDocument();
  });

  it('이름·지역·대표 라벨 색을 보이고, 뒤 Task의 버튼은 자리만 있다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ candidates: [P3] }));
    await open(lib);
    const panel = screen.getByRole('region', { name: '후보 칸' });
    const row = within(panel).getByText('속초 횟집').closest('li')!;
    expect(within(row).getByText('속초')).toBeInTheDocument();
    expect(within(row).getByRole('img', { name: '맛집' })).toBeInTheDocument();
    for (const name of ['보관함에서 더하기', '링크·핀으로 새로 추가', 'Day 자동 나누기']) {
      expect(within(panel).getByRole('button', { name })).toBeDisabled();
    }
  });
});

describe('구간과 경로 상태', () => {
  it('성공·경로 없음·실패(다시 시도)를 구간마다 보인다', async () => {
    const routes = fakeRoutes((call, nth) => {
      if (call.to === '안목 카페거리') return route(12, 1100);
      if (call.to === '속초 횟집') return 'NO_ROUTE';
      return nth === 1 ? 'UPSTREAM_ERROR' : route(20, 2300); // 속초 횟집 → 창가 자리
    });
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P2, P3, P5]] }));
    await open(lib, { routes });
    const user = userEvent.setup();

    const ok = legRow('중앙시장 닭강정', '안목 카페거리');
    expect(await within(ok).findByText('12분 · 1.1km')).toBeInTheDocument();
    expect(within(ok).queryByText('직선 추정')).not.toBeInTheDocument();

    const none = legRow('안목 카페거리', '속초 횟집');
    expect(await within(none).findByText('경로 없음 · 직선 추정')).toBeInTheDocument();

    const failed = legRow('속초 횟집', '창가 자리');
    expect(await within(failed).findByText('경로를 못 가져왔어요')).toBeInTheDocument();
    // 합계는 추정이 섞여 `약`.
    expect(within(timeline()).getByText(/^약 이동 /)).toBeInTheDocument();

    const before = routes.calls.length;
    await user.click(within(failed).getByRole('button', { name: '다시 시도' }));
    expect(await within(failed).findByText('20분 · 2.3km')).toBeInTheDocument();
    expect(routes.calls.length).toBe(before + 1);
    expect(routes.calls.at(-1)).toMatchObject({ to: '창가 자리', refresh: true });
    expect(within(failed).queryByText('경로를 못 가져왔어요')).not.toBeInTheDocument();
  });

  it('오프라인이면 시간표 위에 한 번 안내하고 구간은 직선 추정', async () => {
    // 기본 하네스: 경로 조회가 늘 OFFLINE.
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P2, P5]] }));
    await open(lib);
    expect(
      await screen.findByText('인터넷에 연결되지 않아 이동 시간은 어림값이에요'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('인터넷에 연결되지 않아 이동 시간은 어림값이에요')).toHaveLength(1);
    expect(
      within(legRow('중앙시장 닭강정', '안목 카페거리')).getByText('직선 추정'),
    ).toBeInTheDocument();
    expect(within(timeline()).queryByText('경로를 못 가져왔어요')).not.toBeInTheDocument();
    expect(within(timeline()).getByText(/^약 이동 /)).toBeInTheDocument();
    expect(within(timeline()).queryByText(/조회$/)).not.toBeInTheDocument();
  });

  it('합계에 이동 시간·거리·통행료와 조회 날짜를 보이고, 다시 계산은 캐시를 건너뛴다', async () => {
    const routes = fakeRoutes((call, nth) =>
      call.to === '안목 카페거리'
        ? route(50, 30_000, {
            toll: 3000,
            queriedAt: nth === 1 ? '2026-10-12T03:00:00.000Z' : '2026-10-13T03:00:00.000Z',
          })
        : route(30, 24_000, { queriedAt: '2026-10-13T01:00:00.000Z' }),
    );
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P2, P3]], legModes: {} }));
    await open(lib, { routes });
    const user = userEvent.setup();

    expect(
      await within(timeline()).findByText('이동 1시간 20분 · 54km · 통행료 3,000원'),
    ).toBeInTheDocument();
    expect(within(timeline()).getByText('10월 12일 조회')).toBeInTheDocument();

    await user.click(within(timeline()).getByRole('button', { name: '다시 계산' }));
    expect(await within(timeline()).findByText('10월 13일 조회')).toBeInTheDocument();
    const refreshed = routes.calls.filter((c) => c.refresh);
    expect(refreshed.map((c) => c.to).sort()).toEqual(['속초 횟집', '안목 카페거리']);
  });

  it('고른 Day의 구간을 먼저 요청하고 다른 Day도 미리 요청한다', async () => {
    const routes = fakeRoutes(() => route(10, 1000));
    const lib = withTrip(
      plannerLibrary(),
      makeTrip({
        stops: [
          [P5, P2],
          [P1, P3],
        ],
      }),
    );
    await open(lib, { routes });
    await waitFor(() => expect(routes.calls).toHaveLength(2));
    expect(routes.calls[0]).toMatchObject({ from: '창가 자리', to: '안목 카페거리' });
    expect(routes.calls[1]).toMatchObject({ from: '중앙시장 닭강정', to: '속초 횟집' });
  });

  it('같은 지점 구간(출발지 = 첫 장소)은 묻지 않고 0분 행도 보이지 않는다', async () => {
    const routes = fakeRoutes(() => route(12, 1100));
    const lib = withTrip(plannerLibrary(), makeTrip({ origin: P1, stops: [[P1, P2]] }));
    await open(lib, { routes });
    expect(
      await within(legRow('중앙시장 닭강정', '안목 카페거리')).findByText('12분 · 1.1km'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('listitem', { name: '중앙시장 닭강정 → 중앙시장 닭강정' }),
    ).not.toBeInTheDocument();
    expect(within(timeline()).queryByText(/^0분/)).not.toBeInTheDocument();
    expect(routes.calls.every((c) => c.from !== c.to)).toBe(true);
  });
});

describe('수단 바꾸기', () => {
  it('도보로 바꾸면 legModes에 저장하고 도보로 다시 요청한다', async () => {
    const routes = fakeRoutes((call) =>
      call.mode === 'walk' ? route(70, 5200, { mode: 'walk', toll: null }) : route(12, 1100),
    );
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P2]] }));
    const { store } = await open(lib, { routes });
    const user = userEvent.setup();

    const leg = legRow('중앙시장 닭강정', '안목 카페거리');
    expect(await within(leg).findByText('12분 · 1.1km')).toBeInTheDocument();
    expect(within(leg).getByText('자동차')).toBeInTheDocument();
    await user.click(within(leg).getByRole('button', { name: /이동 수단 바꾸기/ }));
    await user.click(screen.getByRole('menuitem', { name: '도보' }));

    await waitFor(() =>
      expect(store.get(libraryAtom).trips[TRIP]!.legModes.value).toEqual({
        [`${P1}>${P2}`]: 'walk',
      }),
    );
    const walkLeg = legRow('중앙시장 닭강정', '안목 카페거리');
    expect(await within(walkLeg).findByText('1시간 10분 · 5.2km')).toBeInTheDocument();
    expect(within(walkLeg).getByText('도보')).toBeInTheDocument();
    expect(routes.calls.some((c) => c.mode === 'walk' && c.to === '안목 카페거리')).toBe(true);
  });

  it('직선 50km를 넘는 구간은 도보를 고를 수 없다', async () => {
    const routes = fakeRoutes(() => route(60, 70_000));
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P2, P3]] }));
    await open(lib, { routes });
    const user = userEvent.setup();
    const leg = legRow('안목 카페거리', '속초 횟집');
    await user.click(within(leg).getByRole('button', { name: /이동 수단 바꾸기/ }));
    expect(screen.getByRole('menuitem', { name: '도보' })).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('Day 머리와 꼬리', () => {
  it('출발 시각을 바꾸면 도착 시각을 다시 계산하고, 빈 값은 저장하지 않는다', async () => {
    const routes = fakeRoutes(() => route(12, 1100));
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P2]] }));
    const { store } = await open(lib, { routes });
    expect(await within(stopRow('안목 카페거리')).findByText('09:12')).toBeInTheDocument();

    const input = within(timeline()).getByLabelText('출발 시각');
    expect(input).toHaveValue('09:00');
    fireEvent.change(input, { target: { value: '10:30' } });
    await waitFor(() =>
      expect(store.get(libraryAtom).trips[TRIP]!.days[0]!.startTime.value).toBe('10:30'),
    );
    expect(within(stopRow('중앙시장 닭강정')).getByText('10:30')).toBeInTheDocument();
    expect(within(stopRow('안목 카페거리')).getByText('10:42')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '' } });
    await act(async () => {});
    expect(store.get(libraryAtom).trips[TRIP]!.days[0]!.startTime.value).toBe('10:30');
  });

  it('출발점 이름을 보이고, 없으면 첫 장소에서 출발한다고 알린다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ origin: HOUSE, stops: [[P1], [P2]] }));
    await open(lib);
    expect(within(timeline()).getByText('바다 숙소')).toBeInTheDocument();
    expect(within(timeline()).getByRole('button', { name: '순서 정리' })).toBeDisabled();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Day 2 10.24(토)' }));
    expect(within(timeline()).getByText('첫 장소에서 출발')).toBeInTheDocument();
  });

  it('숙소 정하기: 기본은 그날만, 체크하면 다음 날들도 같은 숙소', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ days: 3, stops: [[P1]] }));
    const { store } = await open(lib);
    const user = userEvent.setup();

    await user.click(within(timeline()).getByRole('button', { name: '숙소 정하기' }));
    let dialog = screen.getByRole('dialog', { name: '숙소 정하기' });
    expect(
      within(dialog).getByRole('checkbox', { name: '다음 날들도 같은 숙소' }),
    ).not.toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: /바다 숙소/ }));
    await waitFor(() =>
      expect(store.get(libraryAtom).trips[TRIP]!.days.map((d) => d.lodging.value)).toEqual([
        HOUSE,
        null,
        null,
      ]),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '숙소 정하기' })).toBeNull());
    expect(within(timeline()).getByText('바다 숙소')).toBeInTheDocument();

    await user.click(within(timeline()).getByRole('button', { name: '숙소 바꾸기' }));
    dialog = screen.getByRole('dialog', { name: '숙소 정하기' });
    await user.click(within(dialog).getByRole('checkbox', { name: '다음 날들도 같은 숙소' }));
    await user.click(within(dialog).getByRole('button', { name: /안목 카페거리/ }));
    await waitFor(() =>
      expect(store.get(libraryAtom).trips[TRIP]!.days.map((d) => d.lodging.value)).toEqual([
        P2,
        P2,
        P2,
      ]),
    );
  });

  it('장소가 0곳인 Day는 안내를 보인다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ candidates: [P1] }));
    await open(lib);
    expect(within(timeline()).getByText('장소를 넣어 보세요')).toBeInTheDocument();
  });
});

describe('Day 탭', () => {
  it('탭을 바꾸면 그 Day의 시간표와 ＋의 대상이 바뀐다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[], [P5]], candidates: [P1] }));
    await open(lib);
    const user = userEvent.setup();

    expect(screen.getByRole('tab', { name: 'Day 1 10.23(금)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(timeline()).getByText('장소를 넣어 보세요')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '중앙시장 닭강정을 Day 1에 넣기' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Day 2 10.24(토)' }));
    expect(screen.getByRole('tab', { name: 'Day 2 10.24(토)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(timeline()).getByText('창가 자리')).toBeInTheDocument();
    expect(within(timeline()).queryByText('장소를 넣어 보세요')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '중앙시장 닭강정을 Day 2에 넣기' }),
    ).toBeInTheDocument();
  });
});

describe('화면 열기', () => {
  it('보관함에서 지운 장소가 있으면 토스트를 한 번 보인다', async () => {
    const lib = withTrip(plannerLibrary(), makeTrip({ stops: [[P1, GONE], [P5]] }));
    await open(lib);
    const user = userEvent.setup();
    expect(within(timeline()).queryByText('지운 가게')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Day 2 10.24(토)' }));
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0]![0]).toBe('보관함에서 지운 1곳은 일정에서 빠졌어요');
  });

  it('지운 장소가 없으면 토스트를 보이지 않는다', async () => {
    await open(withTrip(plannerLibrary(), makeTrip({ stops: [[P1]] })));
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('없는 여행이면 안내와 여행 목록으로 가는 링크', async () => {
    const { router } = await open(plannerLibrary(), { path: '/trips/nothing000' });
    expect(screen.getByText('여행을 찾지 못했어요')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: '여행 목록으로' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/trips'));
  });

  it('넓은 화면은 후보 칸·지도 자리·시간표 칸을 나란히 둔다', async () => {
    await open(withTrip(plannerLibrary(), makeTrip()));
    expect(screen.getByRole('region', { name: '후보 칸' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '지도' })).toBeInTheDocument();
    expect(timeline()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '후보 칸 접기' })).not.toBeInTheDocument();
  });

  it('중간 폭에서는 후보 칸을 접고 펼칠 수 있다', async () => {
    await open(withTrip(plannerLibrary(), makeTrip({ candidates: [P1] })), { width: 1000 });
    const user = userEvent.setup();
    expect(screen.getByRole('region', { name: '후보 칸' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '후보 칸 접기' }));
    expect(screen.queryByRole('region', { name: '후보 칸' })).not.toBeInTheDocument();
    expect(timeline()).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '후보 칸 펼치기' }));
    expect(screen.getByRole('region', { name: '후보 칸' })).toBeInTheDocument();
  });

  it('좁은 화면은 지도 자리와 일정 시트(후보·Day 탭, 높이 세 단계)', async () => {
    await open(withTrip(plannerLibrary(), makeTrip({ stops: [[P5]], candidates: [P1, P2] })), {
      width: 375,
    });
    const user = userEvent.setup();
    expect(screen.getByRole('region', { name: '지도' })).toBeInTheDocument();
    const sheet = screen.getByRole('region', { name: '일정 시트' });
    expect(within(sheet).getByRole('tab', { name: '후보 2' })).toBeInTheDocument();
    expect(within(sheet).getByRole('tab', { name: 'Day 1' })).toBeInTheDocument();
    expect(within(sheet).getByRole('tab', { name: 'Day 2' })).toBeInTheDocument();

    // 후보 탭이 기본이고 ＋는 Day 1에 넣는다.
    expect(
      within(sheet).getByRole('button', { name: '중앙시장 닭강정을 Day 1에 넣기' }),
    ).toBeInTheDocument();

    await user.click(within(sheet).getByRole('tab', { name: 'Day 1' }));
    expect(within(sheet).getByText('창가 자리')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('출발 시각')).toBeInTheDocument();

    const handle = within(sheet).getByRole('button', { name: '시트 높이 바꾸기' });
    expect(sheet).toHaveAttribute('data-snap', 'half');
    await user.click(handle);
    expect(sheet).toHaveAttribute('data-snap', 'full');
    await user.click(handle);
    expect(sheet).toHaveAttribute('data-snap', 'collapsed');
    // 접힌 상태에서 탭을 누르면 반쯤 연다.
    await user.click(within(sheet).getByRole('tab', { name: 'Day 2' }));
    expect(sheet).toHaveAttribute('data-snap', 'half');
  });
});
