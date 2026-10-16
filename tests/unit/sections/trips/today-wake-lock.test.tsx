import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { installMapResources } from '../../components/helpers/map-resources';
import { HOUSE, P1, P2, route } from './planner-fixtures';
import {
  fakeRoutes,
  NOW,
  plannerLibrary,
  renderToday,
  todayTrip,
  withTrip,
} from './today-fixtures';

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

// 여행 당일 모드의 화면 켜 두기(스펙 §4.9). `navigator.wakeLock`은 가짜로 갈아 끼운다.

const MENU = '오늘 일정 메뉴';
const ITEM = '화면 켜 두기';
const BADGE = '화면 켜 둠';
const FAILED = '화면 켜 두기를 쓸 수 없어요';

let visibility: DocumentVisibilityState = 'visible';
const setVisibility = (state: DocumentVisibilityState) => {
  visibility = state;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

type Lock = EventTarget & { release: ReturnType<typeof vi.fn> };
/** 진짜 `WakeLockSentinel`처럼 놓이면(`release()`든 시스템이든) `release` 이벤트를 낸다. */
function fakeLock(): Lock {
  const lock = Object.assign(new EventTarget(), {
    release: vi.fn(async () => {
      lock.dispatchEvent(new Event('release'));
    }),
  });
  return lock;
}
/** 시스템(배터리 절약·숨김 등)이 잠금을 놓는다. */
const systemReleases = (lock: Lock) => {
  act(() => {
    lock.dispatchEvent(new Event('release'));
  });
};
/**
 * `request`·`release`를 세는 가짜 Screen Wake Lock. `reject`면 요청이 거절된다.
 * `grantFirst`가 있으면 처음 그만큼만 받아 주고 그 뒤 요청은 거절된다.
 */
function fakeWakeLock(options: { reject?: boolean; grantFirst?: number } = {}) {
  const locks: Lock[] = [];
  const request = vi.fn(async () => {
    const refused =
      options.reject === true ||
      (options.grantFirst !== undefined && locks.length >= options.grantFirst);
    if (refused) throw new DOMException('저전력', 'NotAllowedError');
    const lock = fakeLock();
    locks.push(lock);
    return lock;
  });
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
  return { request, locks };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  installMapResources();
});
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  toastMock.mockClear();
  delete (navigator as { wakeLock?: unknown }).wakeLock;
});

const lib = () => withTrip(plannerLibrary(), todayTrip({ origin: HOUSE, stops: [[P1, P2]] }));
const setup = () => renderToday(lib(), { routes: fakeRoutes(() => route(20, 5000)) });

async function openMenu() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: MENU }));
  return user;
}
const item = () => screen.getByRole('menuitemcheckbox', { name: ITEM });

describe('당일 모드 화면 켜 두기', () => {
  it('켜면 request(screen) 1회와 머리 표시, 다시 누르면 release', async () => {
    const wake = fakeWakeLock();
    await setup();
    const user = await openMenu();
    expect(item()).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText(BADGE)).toBeNull();

    await user.click(item());
    await waitFor(() => expect(wake.request).toHaveBeenCalledTimes(1));
    expect(wake.request).toHaveBeenCalledWith('screen');
    expect(screen.getByText(BADGE)).toBeInTheDocument();
    expect(item()).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(wake.locks).toHaveLength(1));
    expect(wake.locks[0]!.release).not.toHaveBeenCalled();

    await user.click(item());
    expect(wake.locks[0]!.release).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(BADGE)).toBeNull();
    expect(item()).toHaveAttribute('aria-checked', 'false');
    expect(wake.request).toHaveBeenCalledTimes(1);
  });

  it('켜 둔 채 숨었다가 다시 보이면 다시 요청한다(2회째)', async () => {
    const wake = fakeWakeLock();
    await setup();
    const user = await openMenu();
    await user.click(item());
    await waitFor(() => expect(wake.locks).toHaveLength(1));

    setVisibility('hidden');
    expect(wake.request).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await waitFor(() => expect(wake.request).toHaveBeenCalledTimes(2));
    expect(screen.getByText(BADGE)).toBeInTheDocument();
  });

  it('끈 상태에서는 다시 보여도 요청하지 않는다', async () => {
    const wake = fakeWakeLock();
    await setup();
    await screen.findByRole('button', { name: MENU });
    setVisibility('hidden');
    setVisibility('visible');
    expect(wake.request).not.toHaveBeenCalled();
  });

  it('요청이 거절되면 끔으로 돌리고 토스트', async () => {
    const wake = fakeWakeLock({ reject: true });
    await setup();
    const user = await openMenu();
    await user.click(item());
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(FAILED));
    expect(wake.request).toHaveBeenCalledTimes(1);
    expect(item()).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText(BADGE)).toBeNull();
  });

  it('wakeLock이 없으면 메뉴 항목을 그리지 않는다', async () => {
    await setup();
    await openMenu();
    expect(screen.getByRole('menuitem', { name: '계획 화면으로' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull();
    expect(screen.queryByText(ITEM)).toBeNull();
  });

  it('화면을 떠나면 release', async () => {
    const wake = fakeWakeLock();
    await setup();
    const user = await openMenu();
    await user.click(item());
    await waitFor(() => expect(wake.locks).toHaveLength(1));
    cleanup(); // 화면을 걷어 낸다(언마운트)
    expect(wake.locks[0]!.release).toHaveBeenCalledTimes(1);
  });

  it('요청이 끝나기 전에 끄면 늦게 받은 잠금도 바로 놓는다', async () => {
    const locks: Lock[] = [];
    let grant: () => void = () => {};
    const request = vi.fn(
      () =>
        new Promise<Lock>((resolve) => {
          grant = () => {
            const lock = fakeLock();
            locks.push(lock);
            resolve(lock);
          };
        }),
    );
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    await setup();
    const user = await openMenu();
    await user.click(item());
    await user.click(item());
    await act(async () => grant());
    expect(locks).toHaveLength(1);
    expect(locks[0]!.release).toHaveBeenCalledTimes(1);
  });

  it('보이는 동안 시스템이 잠금을 놓으면 한 번 다시 요청하고 켜 둠을 유지한다', async () => {
    const wake = fakeWakeLock();
    await setup();
    const user = await openMenu();
    await user.click(item());
    await waitFor(() => expect(wake.locks).toHaveLength(1));

    systemReleases(wake.locks[0]!);
    await waitFor(() => expect(wake.request).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(wake.locks).toHaveLength(2));
    expect(screen.getByText(BADGE)).toBeInTheDocument();
    expect(item()).toHaveAttribute('aria-checked', 'true');
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('다시 요청이 거절되면 끔으로 돌리고 토스트', async () => {
    const wake = fakeWakeLock({ grantFirst: 1 });
    await setup();
    const user = await openMenu();
    await user.click(item());
    await waitFor(() => expect(wake.locks).toHaveLength(1));

    systemReleases(wake.locks[0]!);
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(FAILED));
    expect(wake.request).toHaveBeenCalledTimes(2);
    expect(item()).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText(BADGE)).toBeNull();
  });

  it('다시 받은 잠금도 시스템이 놓으면 더 요청하지 않고 끔과 토스트', async () => {
    const wake = fakeWakeLock();
    await setup();
    const user = await openMenu();
    await user.click(item());
    await waitFor(() => expect(wake.locks).toHaveLength(1));
    systemReleases(wake.locks[0]!);
    await waitFor(() => expect(wake.locks).toHaveLength(2));

    systemReleases(wake.locks[1]!);
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(FAILED));
    expect(wake.request).toHaveBeenCalledTimes(2);
    expect(item()).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText(BADGE)).toBeNull();
  });

  it('숨으면서 시스템이 놓은 잠금은 바로 다시 요청하지 않고 다시 보일 때 요청한다', async () => {
    const wake = fakeWakeLock();
    await setup();
    const user = await openMenu();
    await user.click(item());
    await waitFor(() => expect(wake.locks).toHaveLength(1));

    // 브라우저는 숨김 알림보다 먼저 잠금을 놓을 수 있다.
    visibility = 'hidden';
    systemReleases(wake.locks[0]!);
    setVisibility('hidden');
    await act(async () => {});
    expect(wake.request).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await waitFor(() => expect(wake.request).toHaveBeenCalledTimes(2));
    expect(screen.getByText(BADGE)).toBeInTheDocument();
    expect(toastMock).not.toHaveBeenCalled();
  });
});
