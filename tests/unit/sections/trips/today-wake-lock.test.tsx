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

type Lock = { release: ReturnType<typeof vi.fn> };
/** `request`·`release`를 세는 가짜 Screen Wake Lock. `reject`면 요청이 거절된다. */
function fakeWakeLock(options: { reject?: boolean } = {}) {
  const locks: Lock[] = [];
  const request = vi.fn(async () => {
    if (options.reject) throw new DOMException('저전력', 'NotAllowedError');
    const lock: Lock = { release: vi.fn(async () => {}) };
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
            const lock: Lock = { release: vi.fn(async () => {}) };
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
});
