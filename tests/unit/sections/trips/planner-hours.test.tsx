import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisitCheck } from 'src/domain/trips/hours';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { Library, Place } from 'src/schema/library';
import type { HoursDay, PlaceHours } from 'src/server/hours';
import { noticeFor } from 'src/sections/trips/planner/HoursNotice';
import { usePlaceHours, useTripHoursRequests } from 'src/sections/trips/planner/use-place-hours';
import { libraryAtom } from 'src/stores/library-state';
import { hoursStatesAtom } from 'src/stores/place-hours';
import { makePlace, withPlaces } from '../library/fixtures';
import {
  at,
  fakeHours,
  fakeRoutes,
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
    expect(noticeFor({ kind: 'loading' }, check())).toBeNull();
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
