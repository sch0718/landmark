import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import { Effect, ManagedRuntime } from 'effect';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisitCheck } from 'src/domain/trips/hours';
import { setAppRuntimeForTest, type AppRuntime } from 'src/lib/effect/runtime';
import type { Library, Place } from 'src/schema/library';
import type { HoursDay, PlaceHours } from 'src/server/hours';
import { noticeFor } from 'src/sections/trips/planner/HoursNotice';
import { usePlaceHours, useTripHoursRequests } from 'src/sections/trips/planner/use-place-hours';
import { libraryAtom } from 'src/stores/library-state';
import { hoursStatesAtom } from 'src/stores/place-hours';
import { mapCardAtom } from 'src/stores/trip-planner';
import { makePlace, withPlaces } from '../library/fixtures';
import {
  at,
  fakeHours,
  f,
  fakeRoutes,
  HOUSE,
  makeTrip,
  open,
  P1,
  P2,
  P3,
  plannerLibrary,
  route,
  stopRow,
  timeline,
  TRIP,
  withTrip,
} from './planner-fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 13, 12, 0, 0));
});
afterEach(() => {
  setAppRuntimeForTest(null);
  vi.useRealTimers();
});

// ---------- 영업시간 값 ----------

const S1 = '1001'; // P1 중앙시장 닭강정
const S2 = '1002'; // P2 안목 카페거리
const S3 = '1003'; // P3 속초 횟집

const open11 = (day: string, start: string): HoursDay => ({
  day,
  open: { start, end: '21:00', endsNextDay: false },
  closed: false,
  breaks: [{ start: '14:30', end: '16:30' }],
  lastOrders: ['19:40'],
  note: null,
});
const hoursOf = (sid: string, start: string): PlaceHours => ({
  sid,
  fetchedAt: '2026-10-12T00:00:00.000Z',
  days: [
    ...['금', '토', '일', '월', '화', '목'].map((d) => open11(d, start)),
    {
      day: '수',
      open: null,
      closed: true,
      breaks: [],
      lastOrders: [],
      note: '정기휴무 (매주 수요일)',
    },
  ],
  irregularClosed: [],
  regularClosed: null,
  note: null,
  otherSchedules: [],
});
/** 단천면옥(11733192) 값: 11:00~21:00, 브레이크타임 14:30~16:30, 라스트오더 19:40, 수요일 정기휴무. */
const dancheon = (sid: string) => hoursOf(sid, '11:00');
/** 단천면옥과 같고 10:00에 여는 값(나중 답과 구별용). */
const early = (sid: string) => hoursOf(sid, '10:00');

// ---------- 화면 ----------

// Day 1 = 2026-10-16(금), Day 2 = 2026-10-17(토).
const START = '2026-10-16';
const KAKAO = 'place00007';

function library(stops: string[][]): Library {
  const base = plannerLibrary();
  const kakao: Place = {
    ...at(makePlace(7, { name: '카카오 국수' }), 128.91, 37.751),
    source: { kind: 'kakao', kakaoId: '777' },
  };
  return withTrip(withPlaces(base, [kakao]), makeTrip({ start: START, stops }));
}

const routes = () => fakeRoutes(() => route(12, 1100));
const CHIP_P1 = '09:00 도착 — 영업 시작 11:00';

/** 앱과 같은 저장소로 한 장소의 `usePlaceHours`를 따로 그린다(카드 없이 `다시 확인`을 부르려고). */
function renderPlaceHours(store: Parameters<typeof Provider>[0]['store'], placeId: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const place = store!.get(libraryAtom).places[placeId]!;
  return renderHook(() => usePlaceHours(place), { wrapper });
}

describe('시간표 행의 영업시간 줄', () => {
  it('영업 전에 도착하면 주황 칩을 보이고, 출발 시각을 늦추면 다시 묻지 않고 칩을 거둔다', async () => {
    const hours = fakeHours((sid) => dancheon(sid));
    const { store } = await open(library([[P1, P2]]), { routes: routes(), hours });

    const chip = await within(stopRow('중앙시장 닭강정')).findByText(CHIP_P1);
    expect(chip).toHaveStyle({
      color: 'var(--tm-label-orange-text)',
      backgroundColor: 'var(--tm-label-orange-fill)',
      fontWeight: 700,
    });
    // 아이콘은 읽지 않는다. 행 버튼 이름에 경고 글이 함께 읽힌다.
    expect(chip.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(
      within(stopRow('중앙시장 닭강정')).getByRole('button', { name: new RegExp(CHIP_P1) }),
    ).toBeInTheDocument();
    const asked = hours.calls.length;

    fireEvent.change(within(timeline()).getByLabelText('출발 시각'), {
      target: { value: '12:00' },
    });
    await waitFor(() =>
      expect(store.get(libraryAtom).trips[TRIP]!.days[0]!.startTime.value).toBe('12:00'),
    );
    expect(within(stopRow('중앙시장 닭강정')).getByText('12:00')).toBeInTheDocument();
    expect(within(stopRow('중앙시장 닭강정')).queryByText(/도착 —/)).not.toBeInTheDocument();
    expect(hours.calls.length).toBe(asked);
  });

  it('카카오 장소 행은 영업시간 확인 필요(보조 글자)이고 묻지 않는다', async () => {
    const hours = fakeHours((sid) => dancheon(sid));
    await open(library([[P1, KAKAO]]), { routes: routes(), hours });

    const line = await within(stopRow('카카오 국수')).findByText('영업시간 확인 필요');
    expect(line).toHaveStyle({ color: 'var(--tm-text-muted)', fontSize: '12px' });
    expect(line.querySelector('svg')).toBeNull();
    expect(hours.calls.map((c) => c.sid)).toEqual([S1]);
  });

  it('받는 중에는 줄이 없다', async () => {
    const hours = fakeHours(() => 'pending');
    await open(library([[P1]]), { routes: routes(), hours });
    await act(async () => {});

    expect(hours.calls).toEqual([{ sid: S1, refresh: false }]);
    const row = stopRow('중앙시장 닭강정');
    expect(within(row).queryByText('영업시간 확인 필요')).not.toBeInTheDocument();
    expect(within(row).queryByText(/도착 —/)).not.toBeInTheDocument();
  });

  it('연결 실패면 확인 필요를 보이고, 인터넷이 돌아오면(online) 다시 묻는다', async () => {
    let online = false;
    const hours = fakeHours((sid) => (online ? dancheon(sid) : 'OFFLINE'));
    await open(library([[P1]]), { routes: routes(), hours });

    expect(
      await within(stopRow('중앙시장 닭강정')).findByText('영업시간 확인 필요'),
    ).toBeInTheDocument();
    expect(hours.calls).toEqual([{ sid: S1, refresh: false }]);

    online = true;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(await within(stopRow('중앙시장 닭강정')).findByText(CHIP_P1)).toBeInTheDocument();
    expect(within(stopRow('중앙시장 닭강정')).queryByText('영업시간 확인 필요')).toBeNull();
    expect(hours.calls).toEqual([
      { sid: S1, refresh: false },
      { sid: S1, refresh: false },
    ]);
  });

  it('서버 문제(UPSTREAM_ERROR)는 online 때도 다시 묻지 않는다', async () => {
    const hours = fakeHours(() => 'UPSTREAM_ERROR');
    await open(library([[P1]]), { routes: routes(), hours });
    expect(
      await within(stopRow('중앙시장 닭강정')).findByText('영업시간 확인 필요'),
    ).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(hours.calls).toHaveLength(1);
  });

  it('다른 Day의 네이버 장소도 묻는다(고른 Day 먼저)', async () => {
    const hours = fakeHours((sid) => dancheon(sid));
    await open(library([[P1, P2], [P3]]), { routes: routes(), hours });
    await within(stopRow('중앙시장 닭강정')).findByText(CHIP_P1);

    expect(hours.calls.map((c) => c.sid)).toEqual([S1, S2, S3]);
    expect(hours.calls.every((c) => !c.refresh)).toBe(true);
  });

  it('고른 Day가 Day 2면 Day 2의 장소를 먼저 묻는다', async () => {
    const hours = fakeHours(() => 'pending');
    // 앱은 목록에 두고(런타임·보관함 준비), 같은 저장소로 요청 훅만 Day 2로 그린다.
    const { store } = await open(library([[P1, P2], [P3]]), { hours, path: '/trips' });
    expect(hours.calls).toEqual([]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    renderHook(() => useTripHoursRequests(TRIP, 1), { wrapper });
    expect(hours.calls.map((c) => c.sid)).toEqual([S3, S1, S2]);
  });

  it('같은 장소는 다시 그려도, 카드가 함께 물어도 한 번만 묻는다', async () => {
    const hours = fakeHours((sid) => dancheon(sid));
    const { store } = await open(library([[P1, P2], [P3]]), { routes: routes(), hours });
    await within(stopRow('중앙시장 닭강정')).findByText(CHIP_P1);
    expect(hours.calls.map((c) => c.sid)).toEqual([S1, S2, S3]);

    // 다른 Day를 고르고(다시 그림) 문서를 바꿔도(출발 시각) 다시 묻지 않는다.
    fireEvent.click(screen.getByRole('tab', { name: /Day 2/ }));
    expect(
      await within(stopRow('속초 횟집')).findByText(/도착 — 영업 시작 11:00/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Day 1/ }));
    fireEvent.change(within(timeline()).getByLabelText('출발 시각'), {
      target: { value: '09:30' },
    });
    await waitFor(() =>
      expect(store.get(libraryAtom).trips[TRIP]!.days[0]!.startTime.value).toBe('09:30'),
    );
    // 상태가 있는 장소는 `request`로 그려도 묻지 않는다.
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const place = store.get(libraryAtom).places[P1]!;
    renderHook(() => usePlaceHours(place, { request: true }), { wrapper });
    await act(async () => {});
    expect(hours.calls.map((c) => c.sid)).toEqual([S1, S2, S3]);
  });
});

describe('영업시간 상태 갱신', () => {
  it('받은 뒤 다시 확인이 연결 실패하면 옛 정보로 칩을 그대로 보인다', async () => {
    const hours = fakeHours((sid, refresh) => (refresh ? 'OFFLINE' : dancheon(sid)));
    const { store } = await open(library([[P1]]), { routes: routes(), hours });
    await within(stopRow('중앙시장 닭강정')).findByText(CHIP_P1);

    const { result } = renderPlaceHours(store, P1);
    await act(async () => result.current.refresh());

    expect(hours.calls.at(-1)).toEqual({ sid: S1, refresh: true });
    expect(store.get(hoursStatesAtom)[S1]).toMatchObject({
      hours: dancheon(S1),
      pending: false,
      error: 'OFFLINE',
      seq: 2,
      refresh: true,
    });
    expect(result.current.view).toMatchObject({ kind: 'known', error: 'OFFLINE', pending: false });
    expect(within(stopRow('중앙시장 닭강정')).getByText(CHIP_P1)).toBeInTheDocument();
  });

  it('다시 확인이 연결 실패한 뒤 online 재시도가 캐시(번호 0)로 답해도 받는 중이 풀리고 정보가 보인다', async () => {
    let phase: 'first' | 'refresh' | 'retry' = 'first';
    const hours = fakeHours((sid) =>
      phase === 'first' ? dancheon(sid) : phase === 'refresh' ? 'OFFLINE' : 'cached',
    );
    const { store } = await open(library([[P1]]), { routes: routes(), hours });
    await within(stopRow('중앙시장 닭강정')).findByText(CHIP_P1);

    const { result } = renderPlaceHours(store, P1);
    phase = 'refresh';
    await act(async () => result.current.refresh());
    expect(store.get(hoursStatesAtom)[S1]).toMatchObject({ error: 'OFFLINE', seq: 2 });

    phase = 'retry';
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    // 다시 확인이 실패했으니 같은 종류(refresh)로 다시 묻는다.
    expect(hours.calls.at(-1)).toEqual({ sid: S1, refresh: true });
    // 번호 0의 답은 내용을 버리지만, 이 장소의 마지막 요청이라 받는 중을 거둔다.
    expect(store.get(hoursStatesAtom)[S1]).toMatchObject({
      hours: dancheon(S1),
      pending: false,
      seq: 2,
    });
    expect(result.current.view).toMatchObject({ kind: 'known', pending: false });
    expect(within(stopRow('중앙시장 닭강정')).getByText(CHIP_P1)).toBeInTheDocument();
  });

  it('늦게 끝난 작은 번호의 답은 큰 번호의 정보를 덮지 않고 받는 중도 남기지 않는다', async () => {
    const hours = fakeHours(() => 'pending');
    const { store } = await open(library([[P1]]), { routes: routes(), hours });
    const { result } = renderPlaceHours(store, P1);
    await act(async () => result.current.refresh());
    expect(hours.calls).toEqual([
      { sid: S1, refresh: false },
      { sid: S1, refresh: true },
    ]);

    // 나중에 시작한 다시 확인(번호 2)이 먼저 끝난다.
    await act(async () => hours.settle(1, early(S1)));
    expect(
      await within(stopRow('중앙시장 닭강정')).findByText('09:00 도착 — 영업 시작 10:00'),
    ).toBeInTheDocument();
    expect(store.get(hoursStatesAtom)[S1]).toMatchObject({ seq: 2, pending: false });

    // 먼저 시작한 보통 요청(번호 1)이 늦게 끝난다: 버린다.
    await act(async () => hours.settle(0, dancheon(S1)));
    expect(store.get(hoursStatesAtom)[S1]).toMatchObject({
      hours: early(S1),
      seq: 2,
      pending: false,
      error: null,
    });
    expect(
      within(stopRow('중앙시장 닭강정')).getByText('09:00 도착 — 영업 시작 10:00'),
    ).toBeInTheDocument();
    expect(within(stopRow('중앙시장 닭강정')).queryByText(CHIP_P1)).toBeNull();
  });

  it('먼저 시작한 요청이 먼저 끝나면 그 정보를 쓰되, 나중 요청이 끝날 때까지 받는 중이다', async () => {
    const hours = fakeHours(() => 'pending');
    const { store } = await open(library([[P1]]), { routes: routes(), hours });
    const { result } = renderPlaceHours(store, P1);
    await act(async () => result.current.refresh());

    await act(async () => hours.settle(0, dancheon(S1)));
    expect(store.get(hoursStatesAtom)[S1]).toMatchObject({ seq: 1, pending: true });
    expect(await within(stopRow('중앙시장 닭강정')).findByText(CHIP_P1)).toBeInTheDocument();

    await act(async () => hours.settle(1, 'UPSTREAM_ERROR'));
    // 실패해도 받아 둔 정보는 남는다.
    expect(store.get(hoursStatesAtom)[S1]).toMatchObject({
      hours: dancheon(S1),
      seq: 2,
      pending: false,
      error: 'UPSTREAM_ERROR',
      refresh: false,
    });
    expect(within(stopRow('중앙시장 닭강정')).getByText(CHIP_P1)).toBeInTheDocument();
  });
  it('작은 번호의 성공 답이 늦게 와도, 큰 번호가 실패해 정보가 없으면 그 정보를 채운다(실패는 남긴다)', async () => {
    const hours = fakeHours(() => 'pending');
    const { store } = await open(library([[P1]]), { routes: routes(), hours });
    const { result } = renderPlaceHours(store, P1);
    await act(async () => result.current.refresh());

    // 나중에 시작한 다시 확인(번호 2)이 먼저 실패한다: 받은 정보가 없어 확인 필요.
    await act(async () => hours.settle(1, 'UPSTREAM_ERROR'));
    expect(store.get(hoursStatesAtom)[S1]).toMatchObject({ hours: null, seq: 2, pending: false });
    expect(result.current.view).toMatchObject({ kind: 'failed', error: 'UPSTREAM_ERROR' });

    // 먼저 시작한 보통 요청(번호 1)이 늦게 성공한다: 번호와 실패는 그대로, 정보만 채운다.
    await act(async () => hours.settle(0, dancheon(S1)));
    expect(store.get(hoursStatesAtom)[S1]).toEqual({
      hours: dancheon(S1),
      pending: false,
      error: 'UPSTREAM_ERROR',
      seq: 2,
      refresh: false,
    });
    expect(result.current.view).toMatchObject({ kind: 'known', error: 'UPSTREAM_ERROR' });
    expect(await within(stopRow('중앙시장 닭강정')).findByText(CHIP_P1)).toBeInTheDocument();
  });
});

describe('영업시간 구독과 중단', () => {
  it('한 장소의 답은 다른 장소를 보는 훅을 다시 그리지 않는다', async () => {
    const hours = fakeHours(() => 'pending');
    const { store } = await open(library([[P1, P2]]), { routes: routes(), hours });
    expect(hours.calls.map((c) => c.sid)).toEqual([S1, S2]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const places = store.get(libraryAtom).places;
    const renders = { [S1]: 0, [S2]: 0 };
    renderHook(
      () => {
        renders[S1] += 1;
        return usePlaceHours(places[P1]!);
      },
      { wrapper },
    );
    renderHook(
      () => {
        renders[S2] += 1;
        return usePlaceHours(places[P2]!);
      },
      { wrapper },
    );
    const before = { ...renders };

    await act(async () => hours.settle(0, dancheon(S1)));
    expect(store.get(hoursStatesAtom)[S1]).toMatchObject({ pending: false });
    expect(renders[S1]).toBeGreaterThan(before[S1]);
    expect(renders[S2]).toBe(before[S2]);
  });

  /** 앱 없이 저장소 하나와 가짜 조회만으로 런타임을 만든다(정리하면 진행 중인 요청이 중단된다). */
  function runtimeWith(hours: ReturnType<typeof fakeHours>): AppRuntime {
    const runtime = ManagedRuntime.make(hours.layer) as unknown as AppRuntime;
    setAppRuntimeForTest(runtime);
    return runtime;
  }
  const naverPlace = () => plannerLibrary().places[P1]!;

  it('앞 요청이 남긴 빈 상태에서 다시 확인이 중단되면 상태를 지워 받는 중에 갇히지 않는다', async () => {
    const hours = fakeHours(() => 'pending');
    const runtime = runtimeWith(hours);
    const store = createStore();
    // 다른 화면이 시작한 첫 요청이 아직 받는 중이다(정보도 실패도 없음).
    store.set(hoursStatesAtom, {
      [S1]: { hours: null, pending: true, error: null, seq: 0, refresh: false },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result } = renderHook(() => usePlaceHours(naverPlace()), { wrapper });
    expect(result.current.view).toEqual({ kind: 'loading', pending: true });

    await act(async () => result.current.refresh());
    expect(hours.calls).toEqual([{ sid: S1, refresh: true }]);

    // 런타임이 정리되며 이 장소의 마지막 요청이 중단된다.
    await act(async () => {
      await Effect.runPromise(runtime.disposeEffect);
    });
    expect(store.get(hoursStatesAtom)[S1]).toBeUndefined();
    // 카드는 확인 중…에 갇히지 않고 다시 확인을 누를 수 있다.
    expect(result.current.view).toEqual({ kind: 'loading', pending: false });

    const next = fakeHours((sid) => dancheon(sid));
    runtimeWith(next);
    await act(async () => result.current.refresh());
    expect(next.calls).toEqual([{ sid: S1, refresh: true }]);
    expect(result.current.view).toMatchObject({ kind: 'known', pending: false, error: null });
  });

  it('상태가 지워지면 묻는 훅(request)은 다시 묻는다', async () => {
    const hours = fakeHours(() => 'pending');
    const runtime = runtimeWith(hours);
    const store = createStore();
    store.set(hoursStatesAtom, {
      [S1]: { hours: null, pending: true, error: null, seq: 0, refresh: false },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result } = renderHook(() => usePlaceHours(naverPlace(), { request: true }), {
      wrapper,
    });
    // 상태가 있어 묻지 않는다.
    expect(hours.calls).toEqual([]);
    await act(async () => result.current.refresh());

    const next = fakeHours((sid) => dancheon(sid));
    await act(async () => {
      await Effect.runPromise(runtime.disposeEffect);
      runtimeWith(next);
    });
    await waitFor(() => expect(next.calls).toEqual([{ sid: S1, refresh: false }]));
    expect(result.current.view).toMatchObject({ kind: 'known', pending: false });
  });
});

describe('noticeFor', () => {
  const H = dancheon(S1);
  const check =
    (kind: VisitCheck['kind'] = 'ok') =>
    (): VisitCheck =>
      kind === 'before-open'
        ? { kind, visit: { startMin: 540, endMin: 600, waited: false }, opensAt: '11:00' }
        : ({ kind } as VisitCheck);

  it('네이버가 아니거나 받지 못했으면 확인 필요, 받는 중이면 없음', () => {
    const muted = { text: '영업시간 확인 필요', tone: 'muted' };
    expect(noticeFor({ kind: 'unsupported' }, check())).toEqual(muted);
    expect(noticeFor({ kind: 'failed', error: 'NOT_FOUND', pending: false }, check())).toEqual(
      muted,
    );
    expect(noticeFor({ kind: 'loading', pending: true }, check())).toBeNull();
  });

  it('받은 정보는 판정대로: 문제없음은 없음, 모름은 확인 필요, 그 밖은 경고', () => {
    const known = { kind: 'known', hours: H, pending: false, error: null } as const;
    expect(noticeFor(known, check('ok'))).toBeNull();
    expect(noticeFor(known, check('unknown'))).toEqual({
      text: '영업시간 확인 필요',
      tone: 'muted',
    });
    expect(noticeFor({ ...known, error: 'OFFLINE' }, check('before-open'))).toEqual({
      text: '09:00 도착 — 영업 시작 11:00',
      tone: 'warn',
    });
  });
});

describe('지도 카드의 영업시간 칸', () => {
  const CHECKED = '10월 16일 확인 · 네이버';
  /** 단천면옥 값, 확인 시각 2026-10-16 10:00(서울). */
  const checked = (sid: string, fetchedAt = '2026-10-16T01:00:00.000Z'): PlaceHours => ({
    ...dancheon(sid),
    fetchedAt,
  });

  function cardLibrary(
    options: {
      start?: string;
      stops?: string[][];
      candidates?: string[];
      lodging?: (string | null)[];
      startTime?: string;
      origin?: string;
    } = {},
  ): Library {
    const base = library([]);
    const trip = makeTrip({
      start: options.start ?? START,
      stops: options.stops ?? [[P1]],
      candidates: options.candidates,
      lodging: options.lodging,
      origin: options.origin,
    });
    const days = trip.days.map((d, i) =>
      i === 0 && options.startTime !== undefined ? { ...d, startTime: f(options.startTime) } : d,
    );
    return withTrip(base, { ...trip, days });
  }

  async function openCard(
    lib: Library,
    placeId: string,
    hours: ReturnType<typeof fakeHours>,
  ): Promise<{ store: Awaited<ReturnType<typeof open>>['store']; card: HTMLElement }> {
    const { store } = await open(lib, { routes: routes(), hours });
    await act(async () => store.set(mapCardAtom, { tripId: TRIP, placeId }));
    const name = store.get(libraryAtom).places[placeId]!.name.value;
    return { store, card: await screen.findByRole('dialog', { name }) };
  }

  it('고른 Day의 장소: 그날 규칙·덧붙임·도착 시각 경고·확인 날짜·다시 확인', async () => {
    const hours = fakeHours((sid) => checked(sid));
    const { card } = await openCard(cardLibrary({ startTime: '15:40' }), P1, hours);

    expect(within(card).getByRole('heading', { level: 3, name: '영업시간' })).toBeInTheDocument();
    expect(await within(card).findByText('Day 1 · 10.16(금) · 11:00~21:00')).toBeInTheDocument();
    expect(
      within(card).getByText('브레이크타임 14:30~16:30 · 라스트오더 19:40'),
    ).toBeInTheDocument();
    const chip = within(card).getByText('15:40 도착 — 브레이크타임 14:30~16:30');
    expect(chip).toHaveStyle({ backgroundColor: 'var(--tm-label-orange-fill)', fontWeight: 700 });
    const line = within(card).getByText(CHECKED);
    expect(line).toHaveAttribute('aria-live', 'polite');
    const button = within(card).getByRole('button', { name: '다시 확인' });
    expect(button).toBeEnabled();
    expect(button).toHaveStyle({ minHeight: '44px' });
    expect(within(card).queryByText(/고르면 확인해요/)).not.toBeInTheDocument();
  });

  it('다시 확인은 새로 받고, 받는 동안 확인 중…(누름 무시, 포커스 유지), 끝나면 확인 날짜가 바뀐다', async () => {
    const hours = fakeHours((sid, refresh) => (refresh ? 'pending' : checked(sid)));
    const { card } = await openCard(cardLibrary(), P1, hours);
    await within(card).findByText(CHECKED);

    const button = within(card).getByRole('button', { name: '다시 확인' });
    act(() => button.focus());
    fireEvent.click(button);
    expect(hours.calls.at(-1)).toEqual({ sid: S1, refresh: true });
    const busy = await within(card).findByRole('button', { name: '확인 중…' });
    expect(busy).toBe(button);
    // 받는 동안 포커스를 지닌 채 aria-disabled이고, 누름은 무시한다.
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toHaveAttribute('disabled');
    expect(document.activeElement).toBe(button);
    const asked = hours.calls.length;
    fireEvent.click(busy);
    expect(hours.calls).toHaveLength(asked);
    // 받는 중에도 옛 정보를 그대로 보인다.
    expect(within(card).getByText('Day 1 · 10.16(금) · 11:00~21:00')).toBeInTheDocument();

    await act(async () =>
      hours.settle(hours.calls.length - 1, checked(S1, '2026-10-17T02:00:00.000Z')),
    );
    expect(await within(card).findByText('10월 17일 확인 · 네이버')).toBeInTheDocument();
    const done = within(card).getByRole('button', { name: '다시 확인' });
    expect(done).toBe(button);
    expect(done).not.toHaveAttribute('aria-disabled');
    expect(document.activeElement).toBe(button);
  });

  it('같은 날 다시 받아 성공해도 확인 날짜 줄(aria-live)이 바뀌어 알린다', async () => {
    const hours = fakeHours((sid, refresh) => (refresh ? 'pending' : checked(sid)));
    const { card } = await openCard(cardLibrary(), P1, hours);
    const live = (await within(card).findByText(CHECKED)).closest('[aria-live]')!;
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live.textContent).toBe(CHECKED);

    for (const at of ['2026-10-16T03:00:00.000Z', '2026-10-16T04:00:00.000Z']) {
      fireEvent.click(within(card).getByRole('button', { name: '다시 확인' }));
      await within(card).findByRole('button', { name: '확인 중…' });
      const during = live.textContent;
      await act(async () => hours.settle(hours.calls.length - 1, checked(S1, at)));
      await within(card).findByRole('button', { name: '다시 확인' });
      // 날짜(10월 16일)는 같지만 줄의 글이 받는 중과 달라진다.
      expect(live.textContent).toBe(`${CHECKED} · 확인했어요`);
      expect(live.textContent).not.toBe(during);
    }
  });

  it('출발지가 있는 Day의 둘째 장소 카드는 그 장소의 도착 시각으로 판정한다', async () => {
    const hours = fakeHours((sid) => checked(sid));
    const lib = cardLibrary({ stops: [[P1, P2]], origin: HOUSE });
    const { store } = await open(lib, { routes: routes(), hours });
    const rowChip = await within(stopRow('안목 카페거리')).findByText(/도착 — 영업 시작 11:00/);
    const firstChip = within(stopRow('중앙시장 닭강정')).getByText(/도착 — 영업 시작 11:00/);
    expect(rowChip.textContent).not.toBe(firstChip.textContent);

    await act(async () => store.set(mapCardAtom, { tripId: TRIP, placeId: P2 }));
    const card = await screen.findByRole('dialog', { name: '안목 카페거리' });
    expect(within(card).getByText(rowChip.textContent!)).toBeInTheDocument();
    expect(within(card).queryByText(firstChip.textContent!)).not.toBeInTheDocument();
  });

  it('고르지 않은 Day의 장소: 그 Day 날짜로 휴무만 보고, 시각은 그 Day를 고르면 확인한다', async () => {
    // Day 1 = 2026-10-20(화), Day 2 = 2026-10-21(수, 정기휴무).
    const hours = fakeHours((sid) => checked(sid));
    const { card } = await openCard(
      cardLibrary({ start: '2026-10-20', stops: [[P1], [P2]] }),
      P2,
      hours,
    );

    expect(
      await within(card).findByText('Day 2 · 10.21(수) · 휴무 — 정기휴무 (매주 수요일)'),
    ).toBeInTheDocument();
    expect(within(card).getByText('휴무일 — 정기휴무 (매주 수요일)')).toBeInTheDocument();
    expect(within(card).getByText('시각은 Day 2를 고르면 확인해요')).toBeInTheDocument();
    expect(within(card).queryByText(/브레이크타임/)).not.toBeInTheDocument();
  });

  it('후보: 그 장소 하나를 묻고 고른 Day 날짜로 규칙을 보인다', async () => {
    const hours = fakeHours((sid) => checked(sid));
    const { store } = await open(cardLibrary({ candidates: [P3] }), { routes: routes(), hours });
    await within(stopRow('중앙시장 닭강정')).findByText(CHIP_P1);
    // 계획 화면은 Day의 장소만 묻는다.
    expect(hours.calls.map((c) => c.sid)).toEqual([S1]);

    await act(async () => store.set(mapCardAtom, { tripId: TRIP, placeId: P3 }));
    const card = screen.getByRole('dialog', { name: '속초 횟집' });
    expect(await within(card).findByText('Day 1 · 10.16(금) · 11:00~21:00')).toBeInTheDocument();
    expect(hours.calls).toEqual([
      { sid: S1, refresh: false },
      { sid: S3, refresh: false },
    ]);
    // 후보는 도착 시각이 없어 휴무·임시 휴무만 경고한다.
    expect(within(card).queryByText(/도착 —/)).not.toBeInTheDocument();
    expect(within(card).queryByText(/고르면 확인해요/)).not.toBeInTheDocument();
  });

  it('카카오 장소는 네이버 장소만 받는다고 하고 다시 확인이 없다', async () => {
    const hours = fakeHours((sid) => checked(sid));
    const { card } = await openCard(cardLibrary({ stops: [[P1, KAKAO]] }), KAKAO, hours);

    const line = within(card).getByText('영업시간 확인 필요 — 네이버 장소만 영업시간을 받아요');
    expect(line).toHaveStyle({ color: 'var(--tm-text-muted)', fontSize: '12px' });
    expect(within(card).queryByRole('button', { name: '다시 확인' })).not.toBeInTheDocument();
    expect(within(card).queryByText(/확인 · 네이버/)).not.toBeInTheDocument();
  });

  it('네이버에 영업시간이 없으면 그렇게 말하고 확인 날짜와 다시 확인을 보인다', async () => {
    const hours = fakeHours((sid) => ({ ...checked(sid), days: [] }));
    const { card } = await openCard(cardLibrary(), P1, hours);

    expect(
      await within(card).findByText('영업시간 확인 필요 — 네이버에 영업시간이 없어요'),
    ).toBeInTheDocument();
    expect(within(card).getByText(CHECKED)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '다시 확인' })).toBeEnabled();
    expect(within(card).queryByText(/^Day 1 · 10\.16/)).not.toBeInTheDocument();
  });

  it('받지 못했으면 실패 이유와 다시 확인을 보인다', async () => {
    const hours = fakeHours(() => 'UPSTREAM_ERROR');
    const { card } = await openCard(cardLibrary(), P1, hours);

    expect(
      await within(card).findByText('영업시간 확인 필요 — 영업시간을 받지 못했어요'),
    ).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '다시 확인' })).toBeEnabled();
    expect(within(card).queryByText(/확인 · 네이버/)).not.toBeInTheDocument();
  });

  it('받은 뒤 다시 확인이 실패하면 옛 규칙과 옛 확인 날짜에 새로 받지 못했어요를 붙인다', async () => {
    const hours = fakeHours((sid, refresh) => (refresh ? 'UPSTREAM_ERROR' : checked(sid)));
    const { card } = await openCard(cardLibrary(), P1, hours);
    await within(card).findByText(CHECKED);

    fireEvent.click(within(card).getByRole('button', { name: '다시 확인' }));
    expect(await within(card).findByText(`${CHECKED} · 새로 받지 못했어요`)).toBeInTheDocument();
    expect(within(card).getByText('Day 1 · 10.16(금) · 11:00~21:00')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '다시 확인' })).toBeEnabled();
  });

  it('계산하지 않는 규칙·네이버 안내·임시·정기 휴무·다른 운영 시간을 한 줄씩 보인다', async () => {
    const hours = fakeHours((sid) => ({
      ...checked(sid),
      days: [
        ...checked(sid).days,
        {
          day: '공휴일',
          open: { start: '10:00', end: '17:00', endsNextDay: false },
          closed: false,
          breaks: [],
          lastOrders: [],
          note: null,
        },
      ],
      note: '라스트오더 점심14:30 /저녁19:30',
      irregularClosed: ['10월 30일 휴무', '11월 2일 휴무'],
      regularClosed: '매월 첫째 월요일',
      otherSchedules: ['포장', '배달'],
    }));
    const { card } = await openCard(cardLibrary(), P1, hours);

    expect(await within(card).findByText('공휴일 10:00~17:00')).toBeInTheDocument();
    expect(within(card).getByText('공휴일 영업시간은 계산에 넣지 않아요')).toBeInTheDocument();
    expect(
      within(card).getByText('네이버 안내: 라스트오더 점심14:30 /저녁19:30'),
    ).toBeInTheDocument();
    expect(
      within(card).getByText('다가오는 임시 휴무: 10월 30일 휴무, 11월 2일 휴무'),
    ).toBeInTheDocument();
    expect(within(card).getByText('정기 휴무: 매월 첫째 월요일')).toBeInTheDocument();
    expect(within(card).getByText('다른 운영 시간도 있어요: 포장, 배달')).toBeInTheDocument();
  });

  it('공휴일이 아닌 계산하지 않는 규칙에는 공휴일 안내를 붙이지 않는다', async () => {
    const hours = fakeHours((sid) => ({
      ...checked(sid),
      days: [...checked(sid).days, { ...open11('평일', '11:00'), breaks: [], lastOrders: [] }],
    }));
    const { card } = await openCard(cardLibrary(), P1, hours);

    expect(await within(card).findByText('평일 11:00~21:00')).toBeInTheDocument();
    expect(within(card).queryByText('공휴일 영업시간은 계산에 넣지 않아요')).toBeNull();
  });

  it('숙소로만 쓰인 장소의 카드에는 영업시간 칸이 없다', async () => {
    const hours = fakeHours((sid) => checked(sid));
    const { card } = await openCard(cardLibrary({ lodging: [HOUSE, null] }), HOUSE, hours);

    expect(within(card).getByText('숙소')).toBeInTheDocument();
    expect(within(card).queryByRole('heading', { name: '영업시간' })).not.toBeInTheDocument();
    expect(within(card).queryByText(/영업시간/)).not.toBeInTheDocument();
    expect(hours.calls.map((c) => c.sid)).toEqual([S1]);
  });
});
