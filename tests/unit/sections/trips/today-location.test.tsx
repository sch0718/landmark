import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeMapAdapter } from 'src/components/map/FakeMapAdapter';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { Geolocation } from 'src/services/geolocation';
import { NOW_TICK_MS } from 'src/sections/trips/today/use-now';
import { installMapResources } from '../../components/helpers/map-resources';
import { fakeGeolocation, type FakeCoords } from '../../helpers/fake-geolocation';
import { HOUSE, P1, P2, route } from './planner-fixtures';
import {
  fakeRoutes,
  nextCard,
  plannerLibrary,
  renderToday,
  todayTrip,
  withTrip,
  withVisited,
} from './today-fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

// 여행 당일 모드의 내 위치(스펙 §4.7·§5.5). 지금은 2026-10-24(토) 10:30, Day 1은 바다 숙소에서 09:00에 나서
// 중앙시장 닭강정(09:20 도착) → 안목 카페거리. 모든 구간 20분(자동차 5km).

const NOW = new Date(2026, 9, 24, 10, 30);
const lib = () => withTrip(plannerLibrary(), todayTrip({ origin: HOUSE, stops: [[P1, P2]] }));
const routes = () => fakeRoutes(() => route(20, 5000));

/** 중앙시장 닭강정(128.9, 37.75)에서 북쪽으로 `m`미터. 위도 0.0009°가 약 100m다. */
const nearP1 = (m: number, accuracy = 30): FakeCoords => ({
  longitude: 128.9,
  latitude: 37.75 + (m / 100) * 0.0009,
  accuracy,
});

let permission: PermissionState | null = null;
let visibility: DocumentVisibilityState = 'visible';
const setVisibility = (state: DocumentVisibilityState) => {
  visibility = state;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  permission = 'prompt';
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: {
      query: vi.fn(async () =>
        permission === null ? Promise.reject(new TypeError('없음')) : { state: permission },
      ),
    },
  });
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete (navigator as { permissions?: unknown }).permissions;
});

async function setup(options: { supported?: boolean; width?: number } = {}) {
  const geo = fakeGeolocation();
  const geolocation = Geolocation.layerWith({
    api: options.supported === false ? undefined : geo.api,
    secure: true,
  });
  const rendered = await renderToday(lib(), {
    routes: routes(),
    geolocation,
    width: options.width,
  });
  return { geo, ...rendered };
}

/** 가장 최근에 건 감시로 위치를 보낸다. `ageMs`만큼 전에 잰 위치. */
const emit = (geo: ReturnType<typeof fakeGeolocation>, coords: FakeCoords, ageMs = 0) => {
  act(() => geo.emit(geo.watchers.size, coords, Date.now() - ageMs));
};
const emitError = (geo: ReturnType<typeof fakeGeolocation>, code: 1 | 2 | 3) => {
  act(() => geo.emitError(geo.watchers.size, code));
};

const OFF_TEXT = '내 위치를 켜면 다음 장소까지 거리와 도착을 알려 드려요';
const DENIED_TEXT = '위치 권한이 꺼져 있어요. 브라우저 설정에서 이 사이트의 위치 권한을 켜 주세요';
const UNAVAILABLE_TEXT = '지금은 위치를 알 수 없어요. 잠시 뒤 다시 해 주세요';
const TIMEOUT_TEXT = '위치를 찾는 데 시간이 너무 오래 걸려요. 다시 해 주세요';
const MY_NAME = encodeURIComponent('내 위치');

const directions = (name: string) =>
  within(nextCard()).getByRole('link', { name: `${name}까지 길찾기` });
const checkButton = (name: string) =>
  within(nextCard()).getByRole('button', { name: `‘${name}’ 다녀옴으로 표시` });

/** 그 문구의 띠(`role="status"`). */
const band = (text: string) => screen.getByText(text).closest('[role="status"]');

describe('당일 모드 내 위치: 켜는 때', () => {
  it('권한을 묻기 전이면 띠와 `내 위치 켜기`, 누르면 감시를 건다', async () => {
    const { geo } = await setup();
    expect(band(OFF_TEXT)).toBeInTheDocument();
    expect(geo.watchers.size).toBe(0);
    const button = screen.getByRole('button', { name: '내 위치 켜기' });
    expect(getComputedStyle(button).minHeight).toBe('44px');
    await userEvent.setup().click(button);
    expect(geo.watchers.size).toBe(1);
    expect(screen.queryByText(OFF_TEXT)).toBeNull();
  });

  it('`내 위치 켜기`를 누르면 띠와 함께 버튼이 사라지므로 포커스는 다음 장소 카드로', async () => {
    await setup();
    screen.getByRole('button', { name: '내 위치 켜기' }).focus();
    await userEvent.setup().keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: '내 위치 켜기' })).toBeNull();
    await waitFor(() => expect(nextCard()).toHaveFocus());
  });

  it('권한을 조회할 수 없어도 `내 위치 켜기`', async () => {
    permission = null;
    const { geo } = await setup();
    expect(screen.getByRole('button', { name: '내 위치 켜기' })).toBeInTheDocument();
    expect(geo.watchers.size).toBe(0);
  });

  it('권한이 이미 `granted`면 들어오자마자 감시하고 띠가 없다', async () => {
    permission = 'granted';
    const { geo } = await setup();
    await waitFor(() => expect(geo.watchers.size).toBe(1));
    expect(screen.queryByText(OFF_TEXT)).toBeNull();
    expect(screen.queryByRole('button', { name: '내 위치 켜기' })).toBeNull();
  });
});

describe('당일 모드 내 위치: 카드·길찾기', () => {
  beforeEach(() => {
    permission = 'granted';
  });

  it('1.2km 떨어져 있으면 `직선 1.2km`, 길찾기는 내 위치에서', async () => {
    const { geo } = await setup();
    await waitFor(() => expect(geo.watchers.size).toBe(1));
    const here = nearP1(1200);
    emit(geo, here);
    expect(within(nextCard()).getByText('직선 1.2km')).toBeInTheDocument();
    expect(within(nextCard()).getByText('다음 · 1번째')).toBeInTheDocument();
    const href = directions('중앙시장 닭강정').getAttribute('href')!;
    expect(MY_NAME).toBe('%EB%82%B4%20%EC%9C%84%EC%B9%98');
    expect(
      href.startsWith(`nmap://route/car?slat=${here.latitude}&slng=128.9&sname=${MY_NAME}&`),
    ).toBe(true);
    expect(href).toContain('dlat=37.75&dlng=128.9&');
    // 늦어짐은 앞 지점(출발점)에서 계산한다.
    expect(
      within(nextCard()).getByText('지금 출발하면 10:50 도착 · 1시간 30분 늦음'),
    ).toBeInTheDocument();
  });

  it('위치에서 직선 800m 이하면 계획 구간이 자동차여도 길찾기는 도보', async () => {
    const { geo } = await setup();
    await waitFor(() => expect(geo.watchers.size).toBe(1));
    emit(geo, nearP1(500));
    expect(directions('중앙시장 닭강정').getAttribute('href')).toMatch(/^nmap:\/\/route\/walk\?/);
  });

  it('100m·정확도 30m면 `지금 여기`, `다녀옴`이 주 버튼, 늦음은 계획 도착부터', async () => {
    const { geo } = await setup();
    await waitFor(() => expect(geo.watchers.size).toBe(1));
    emit(geo, nearP1(100));
    expect(within(nextCard()).getByText('지금 여기 · 1번째')).toBeInTheDocument();
    expect(within(nextCard()).getByText('직선 100m')).toBeInTheDocument();
    expect(checkButton('중앙시장 닭강정')).toHaveClass('MuiButton-contained');
    expect(directions('중앙시장 닭강정')).toHaveClass('MuiButton-outlined');
    // 도착 = max(지금 10:30, 계획 09:20) → 1시간 10분 늦음.
    expect(within(nextCard()).getByText('계획보다 1시간 10분 늦음')).toBeInTheDocument();
  });

  it('위치가 없으면 `다음`, 길찾기가 주 버튼이고 출발점에서', async () => {
    await setup();
    expect(within(nextCard()).getByText('다음 · 1번째')).toBeInTheDocument();
    expect(within(nextCard()).queryByText(/^직선 /)).toBeNull();
    expect(directions('중앙시장 닭강정')).toHaveClass('MuiButton-contained');
    expect(checkButton('중앙시장 닭강정')).toHaveClass('MuiButton-outlined');
    expect(directions('중앙시장 닭강정').getAttribute('href')).toMatch(
      /^nmap:\/\/route\/car\?slat=37\.76&slng=128\.93&/,
    );
  });

  it('100m여도 정확도 250m면 `지금 여기`가 아니다', async () => {
    const { geo } = await setup();
    await waitFor(() => expect(geo.watchers.size).toBe(1));
    emit(geo, nearP1(100, 250));
    expect(within(nextCard()).getByText('다음 · 1번째')).toBeInTheDocument();
    expect(within(nextCard()).queryByText(/^지금 여기/)).toBeNull();
    expect(directions('중앙시장 닭강정')).toHaveClass('MuiButton-contained');
    // 정확도는 `지금 여기`만 막는다. 쓸 수 있는 위치(2분 이내)라 거리와 출발점은 내 위치다(스펙 §4.7).
    expect(within(nextCard()).getByText('직선 100m')).toBeInTheDocument();
    expect(directions('중앙시장 닭강정').getAttribute('href')).toContain(`sname=${MY_NAME}&`);
    expect(
      within(nextCard()).getByText('지금 출발하면 10:50 도착 · 1시간 30분 늦음'),
    ).toBeInTheDocument();
  });

  it('3분 전 위치는 쓰지 않는다: `직선` 없음, 출발점은 앞 지점, `지금 여기` 아님', async () => {
    const { geo } = await setup();
    await waitFor(() => expect(geo.watchers.size).toBe(1));
    emit(geo, nearP1(100), 180_000);
    expect(within(nextCard()).queryByText(/^직선 /)).toBeNull();
    expect(within(nextCard()).getByText('다음 · 1번째')).toBeInTheDocument();
    expect(directions('중앙시장 닭강정').getAttribute('href')).toMatch(
      /^nmap:\/\/route\/car\?slat=37\.76&slng=128\.93&sname=/,
    );
  });

  it('고른 장소도 내 위치에서 길찾기, `지금 여기`는 다음 장소에만', async () => {
    const { geo } = await setup();
    await waitFor(() => expect(geo.watchers.size).toBe(1));
    emit(geo, nearP1(100));
    await userEvent.setup().click(
      within(screen.getByRole('list', { name: '남은 일정' })).getByRole('button', {
        name: '2. 안목 카페거리',
      }),
    );
    expect(within(nextCard()).getByText('고른 장소 · 2번째')).toBeInTheDocument();
    expect(directions('안목 카페거리').getAttribute('href')).toContain(`sname=${MY_NAME}&`);
    expect(directions('안목 카페거리')).toHaveClass('MuiButton-contained');
    expect(checkButton('안목 카페거리')).toHaveClass('MuiButton-outlined');
  });

  it('다음 장소가 숙소여도 `직선`과 내 위치 길찾기', async () => {
    const geo = fakeGeolocation();
    let all = withTrip(
      plannerLibrary(),
      todayTrip({ origin: HOUSE, stops: [[P1, P2]], lodging: [HOUSE] }),
    );
    all = withVisited(withVisited(all, P1, '2026-10-24'), P2, '2026-10-24');
    await renderToday(all, {
      routes: routes(),
      geolocation: Geolocation.layerWith({ api: geo.api, secure: true }),
    });
    await waitFor(() => expect(geo.watchers.size).toBe(1));
    emit(geo, nearP1(1200));
    expect(within(nextCard()).getByText('마지막 · 숙소')).toBeInTheDocument();
    expect(within(nextCard()).getByText(/^직선 \d/)).toBeInTheDocument();
    expect(directions('바다 숙소').getAttribute('href')).toContain(`sname=${MY_NAME}&`);
  });
});

describe('당일 모드 내 위치: 지도', () => {
  let resources: ReturnType<typeof installMapResources>;
  beforeEach(() => {
    permission = 'granted';
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    resources = installMapResources();
  });
  afterEach(() => resources.restore());

  const fakeMap = () => screen.getByTestId('fake-map');

  it('위치를 지도에 점으로 보이고, `내 위치로`를 누르면 그곳으로 옮긴다', async () => {
    const { geo } = await setup();
    await waitFor(() => expect(geo.watchers.size).toBe(1));
    await waitFor(() => expect(screen.getByTestId(`marker-${P1}`)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '내 위치로' })).toBeNull();
    expect(screen.queryByTestId('my-location')).toBeNull();

    const here = nearP1(1200);
    emit(geo, here);
    const dot = await screen.findByTestId('my-location');
    expect(dot).toHaveAttribute('data-lng', '128.9');
    expect(dot).toHaveAttribute('data-lat', String(here.latitude));
    expect(dot).toHaveAttribute('data-accuracy', '30');
    // 위치가 와도 지도는 저절로 옮기지 않는다.
    expect(fakeMap()).not.toHaveAttribute('data-center');

    const button = within(screen.getByTestId('map-controls')).getByRole('button', {
      name: '내 위치로',
    });
    expect(getComputedStyle(button).width).toBe('44px');
    await userEvent.setup().click(button);
    await waitFor(() => expect(fakeMap()).toHaveAttribute('data-center', `128.9,${here.latitude}`));
  });

  it('위치가 올 때마다 핀을 다시 그리지 않는다', async () => {
    const { geo } = await setup();
    await waitFor(() => expect(geo.watchers.size).toBe(1));
    await waitFor(() => expect(screen.getByTestId(`marker-${P1}`)).toBeInTheDocument());
    const setMarkers = vi.spyOn(FakeMapAdapter.prototype, 'setMarkers');
    emit(geo, nearP1(1200));
    emit(geo, nearP1(1100));
    expect(await screen.findByTestId('my-location')).toBeInTheDocument();
    expect(setMarkers).not.toHaveBeenCalled();
  });

  it('30초 틱으로 늦어짐이 바뀌어도 핀·경로선을 다시 그리지 않는다', async () => {
    // 지도 준비(rAF)가 진짜 타이머를 쓰므로 타이머는 흉내 내지 않고, 시각 틱(30초 간격) 콜백만 붙잡아 부른다.
    const intervals = vi.spyOn(window, 'setInterval');
    const { geo } = await setup();
    await waitFor(() => expect(geo.watchers.size).toBe(1));
    await waitFor(() => expect(screen.getByTestId(`marker-${P1}`)).toBeInTheDocument());
    const late = () => within(nextCard()).getByText(/늦음$/).textContent;
    await waitFor(() => expect(late()).toBe('지금 출발하면 10:50 도착 · 1시간 30분 늦음'));
    const tick = intervals.mock.calls.findLast(([, ms]) => ms === NOW_TICK_MS)?.[0] as () => void;
    expect(tick).toBeTypeOf('function');
    const setMarkers = vi.spyOn(FakeMapAdapter.prototype, 'setMarkers');
    const setPolylines = vi.spyOn(FakeMapAdapter.prototype, 'setPolylines');

    vi.setSystemTime(new Date(2026, 9, 24, 10, 31));
    act(() => tick());
    expect(late()).toBe('지금 출발하면 10:51 도착 · 1시간 31분 늦음');
    vi.setSystemTime(new Date(2026, 9, 24, 10, 31, 30));
    act(() => tick());
    expect(setMarkers).not.toHaveBeenCalled();
    expect(setPolylines).not.toHaveBeenCalled();
  });

  it('쓸 수 없는(3분 전) 위치는 지도에 그리지 않는다', async () => {
    const { geo } = await setup();
    await waitFor(() => expect(geo.watchers.size).toBe(1));
    await waitFor(() => expect(screen.getByTestId(`marker-${P1}`)).toBeInTheDocument());
    emit(geo, nearP1(1200), 180_000);
    expect(screen.queryByTestId('my-location')).toBeNull();
    expect(screen.queryByRole('button', { name: '내 위치로' })).toBeNull();
  });
});

describe('당일 모드 내 위치: 오류 띠', () => {
  beforeEach(() => {
    permission = 'granted';
  });

  it('거절이면 문구만(버튼 없음), 위치를 버리고, 다시 보여도 다시 걸지 않는다', async () => {
    const { geo } = await setup();
    await waitFor(() => expect(geo.watchers.size).toBe(1));
    emit(geo, nearP1(1200));
    expect(within(nextCard()).getByText('직선 1.2km')).toBeInTheDocument();
    emitError(geo, 1);
    expect(band(DENIED_TEXT)).toBeInTheDocument();
    expect(geo.cleared).toEqual([1]);
    expect(within(nextCard()).queryByText(/^직선 /)).toBeNull();
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
    expect(screen.queryByRole('button', { name: '내 위치 켜기' })).toBeNull();
    setVisibility('hidden');
    setVisibility('visible');
    expect(geo.watchers.size).toBe(1);
    expect(geo.cleared).toEqual([1]);
    expect(screen.getByText(DENIED_TEXT)).toBeInTheDocument();
  });

  it('못 찾음이면 `다시 시도`, 그 뒤 위치가 오면 띠가 사라진다', async () => {
    const { geo } = await setup();
    await waitFor(() => expect(geo.watchers.size).toBe(1));
    emitError(geo, 2);
    expect(band(UNAVAILABLE_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
    // 서비스가 계속 지켜보므로 다음 위치가 오면 돌아온다.
    emit(geo, nearP1(1200));
    expect(screen.queryByText(UNAVAILABLE_TEXT)).toBeNull();
    expect(within(nextCard()).getByText('직선 1.2km')).toBeInTheDocument();
  });

  it('시간 초과면 `다시 시도`, 누르면 감시를 새로 건다', async () => {
    const { geo } = await setup();
    await waitFor(() => expect(geo.watchers.size).toBe(1));
    emitError(geo, 3);
    expect(band(TIMEOUT_TEXT)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '다시 시도' }));
    expect(geo.cleared).toEqual([1]);
    expect(geo.watchers.size).toBe(2);
    expect(screen.queryByText(TIMEOUT_TEXT)).toBeNull();
  });

  it('`다시 시도`를 누르면 띠와 함께 버튼이 사라지므로 포커스는 다음 장소 카드로', async () => {
    const { geo } = await setup();
    await waitFor(() => expect(geo.watchers.size).toBe(1));
    emitError(geo, 2);
    screen.getByRole('button', { name: '다시 시도' }).focus();
    await userEvent.setup().keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
    await waitFor(() => expect(nextCard()).toHaveFocus());
  });

  it('위치를 쓸 수 없는 브라우저면 띠·버튼 없음', async () => {
    await setup({ supported: false });
    await act(async () => {});
    expect(screen.queryByText(OFF_TEXT)).toBeNull();
    expect(screen.queryByText('이 브라우저에서는 위치를 쓸 수 없어요')).toBeNull();
    expect(screen.queryByRole('button', { name: '내 위치 켜기' })).toBeNull();
  });

  it('권한을 묻기 전에 `내 위치 켜기`를 눌렀는데 쓸 수 없는 브라우저면 띠가 사라진다', async () => {
    permission = 'prompt';
    await setup({ supported: false });
    await userEvent.setup().click(screen.getByRole('button', { name: '내 위치 켜기' }));
    await waitFor(() => expect(screen.queryByText(OFF_TEXT)).toBeNull());
    expect(screen.queryByRole('button', { name: '내 위치 켜기' })).toBeNull();
  });
});

describe('당일 모드 내 위치: 오류 뒤 마지막 위치·낡은 위치', () => {
  let resources: ReturnType<typeof installMapResources>;
  beforeEach(() => {
    permission = 'granted';
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    resources = installMapResources();
  });
  afterEach(() => resources.restore());

  /** `useNow`의 30초 틱 `n`개(시계도 그만큼 흐른다). */
  const ticks = (n: number) => {
    for (let i = 0; i < n; i += 1) act(() => vi.advanceTimersByTime(30_000));
  };
  const card = () => within(nextCard());
  const myButton = () => screen.queryByRole('button', { name: '내 위치로' });

  /**
   * `setInterval`을 가짜로 두면 `waitFor`의 주기 확인과 jsdom의 `requestAnimationFrame`(지도 준비)이 돌지 않는다.
   * 가짜 시계를 조금씩(20ms) 흘리며 본다. 틱(30초)에는 닿지 않는다.
   */
  async function until(check: () => void) {
    for (let i = 0; ; i += 1) {
      try {
        check();
        return;
      } catch (error) {
        if (i >= 50) throw error;
      }
      await act(async () => {
        vi.advanceTimersByTime(20);
        await Promise.resolve();
      });
    }
  }

  async function located(coords: FakeCoords) {
    const ready = await setup();
    await until(() => expect(ready.geo.watchers.size).toBe(1));
    await until(() => expect(screen.getByTestId(`marker-${P1}`)).toBeInTheDocument());
    emit(ready.geo, coords);
    await until(() => expect(screen.getByTestId('my-location')).toBeInTheDocument());
    return ready;
  }

  it('시간 초과 뒤에도 마지막 위치를 두고, 2분이 지나면 다음 틱에 버린다', async () => {
    const { geo } = await located(nearP1(100));
    expect(card().getByText('지금 여기 · 1번째')).toBeInTheDocument();
    emitError(geo, 3);
    expect(band(TIMEOUT_TEXT)).toBeInTheDocument();
    expect(card().getByText('지금 여기 · 1번째')).toBeInTheDocument();
    expect(card().getByText('직선 100m')).toBeInTheDocument();
    expect(screen.getByTestId('my-location')).toBeInTheDocument();
    expect(myButton()).not.toBeNull();

    // 120초(틱 4개)까지는 쓴다.
    ticks(4);
    expect(card().getByText('직선 100m')).toBeInTheDocument();
    // 그다음 틱(150초)에 버린다. 띠는 그대로다.
    ticks(1);
    expect(card().queryByText(/^직선 /)).toBeNull();
    expect(card().queryByText(/^지금 여기/)).toBeNull();
    expect(card().getByText('다음 · 1번째')).toBeInTheDocument();
    expect(screen.queryByTestId('my-location')).toBeNull();
    expect(myButton()).toBeNull();
    expect(screen.getByText(TIMEOUT_TEXT)).toBeInTheDocument();
  });

  it('못 찾음 뒤에도 마지막 위치를 둔다', async () => {
    const { geo } = await located(nearP1(1200));
    emitError(geo, 2);
    expect(band(UNAVAILABLE_TEXT)).toBeInTheDocument();
    expect(card().getByText('직선 1.2km')).toBeInTheDocument();
    expect(screen.getByTestId('my-location')).toBeInTheDocument();
  });

  it('`다시 시도` 뒤에도 아직 쓸 수 있는 위치를 둔다', async () => {
    const { geo } = await located(nearP1(1200));
    emitError(geo, 3);
    act(() => {
      screen.getByRole('button', { name: '다시 시도' }).click();
    });
    expect(screen.queryByText(TIMEOUT_TEXT)).toBeNull();
    expect(geo.watchers.size).toBe(2);
    expect(card().getByText('직선 1.2km')).toBeInTheDocument();
    expect(directions('중앙시장 닭강정').getAttribute('href')).toContain(`sname=${MY_NAME}&`);
    expect(screen.getByTestId('my-location')).toBeInTheDocument();
  });

  it('새 위치가 오지 않으면 2분 뒤 틱에 거리·점·`내 위치로`·지금 여기가 사라진다', async () => {
    await located(nearP1(100));
    expect(card().getByText('지금 여기 · 1번째')).toBeInTheDocument();
    expect(myButton()).not.toBeNull();
    ticks(5);
    expect(card().queryByText(/^직선 /)).toBeNull();
    expect(card().queryByText(/^지금 여기/)).toBeNull();
    expect(screen.queryByTestId('my-location')).toBeNull();
    expect(myButton()).toBeNull();
    // 출발점은 앞 지점(바다 숙소)으로 돌아간다.
    expect(directions('중앙시장 닭강정').getAttribute('href')).toMatch(
      /^nmap:\/\/route\/car\?slat=37\.76&slng=128\.93&/,
    );
  });
});

describe('당일 모드 내 위치: 보일 때만 본다', () => {
  beforeEach(() => {
    permission = 'granted';
  });

  it('숨으면 해제하고 다시 보이면 새로 건다', async () => {
    const { geo } = await setup();
    await waitFor(() => expect(geo.watchers.size).toBe(1));
    setVisibility('hidden');
    expect(geo.cleared).toEqual([1]);
    expect(geo.watchers.size).toBe(1);
    setVisibility('visible');
    expect(geo.watchers.size).toBe(2);
    emit(geo, nearP1(1200));
    expect(within(nextCard()).getByText('직선 1.2km')).toBeInTheDocument();
  });

  it('숨은 동안 켜기를 누르면 보일 때 건다', async () => {
    permission = 'prompt';
    const { geo } = await setup();
    setVisibility('hidden');
    await userEvent.setup().click(screen.getByRole('button', { name: '내 위치 켜기' }));
    expect(geo.watchers.size).toBe(0);
    setVisibility('visible');
    expect(geo.watchers.size).toBe(1);
  });

  it('화면을 떠나면 해제한다', async () => {
    const { geo, router } = await setup();
    await waitFor(() => expect(geo.watchers.size).toBe(1));
    await act(async () => {
      await router.navigate('/trips');
    });
    expect(geo.cleared).toEqual([1]);
  });
});
