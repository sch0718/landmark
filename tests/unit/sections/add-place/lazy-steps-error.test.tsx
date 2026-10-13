import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { addFlowAtom } from 'src/stores/add-place';
import { mockViewport, renderApp } from '../shell/harness';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));
// 새 배포 뒤 옛 파일이 없는 경우처럼, 링크 입력 단계 파일 받기가 실패한다.
vi.mock('src/sections/add-place/LinkInputPanel', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const panel = () => screen.getByRole('region', { name: '장소 추가' });
const NOTICE = '새 버전이 나왔어요. 새로고침해 주세요';

async function openLink() {
  mockViewport(1280);
  const rendered = await renderApp({ preloadPanels: false });
  await act(async () => {
    rendered.store.set(addFlowAtom, { step: 'link', hint: 'place' });
  });
  return rendered;
}

describe('추가 칸 단계 받기 실패', () => {
  it('칸 안에 새 버전 안내와 새로고침 버튼을 보이고, 화면 전체 오류로 번지지 않는다', async () => {
    await openLink();
    expect(await within(panel()).findByText(NOTICE)).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: '새로고침' })).toBeInTheDocument();
    expect(screen.queryByText('문제가 생겨 화면을 표시하지 못했어요')).not.toBeInTheDocument();
    // 셸은 그대로다.
    expect(screen.getByRole('navigation', { name: '사이드 메뉴' })).toBeInTheDocument();
  });

  it('새로고침 버튼은 location.reload를 부른다', async () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    await openLink();
    await within(panel()).findByText(NOTICE);
    fireEvent.click(within(panel()).getByRole('button', { name: '새로고침' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('칸 닫기 버튼으로 칸이 닫힌다', async () => {
    const user = userEvent.setup();
    const { store } = await openLink();
    await within(panel()).findByText(NOTICE);
    await user.click(within(panel()).getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('region', { name: '장소 추가' })).not.toBeInTheDocument();
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
  });
});
