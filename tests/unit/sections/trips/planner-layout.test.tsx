import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { makeTrip, open, P1, P2, plannerLibrary, TRIP, withTrip } from './planner-fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 13, 12, 0, 0));
});
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const lib = () => withTrip(plannerLibrary(), makeTrip({ candidates: [P1] }));
const candidates = () => screen.queryByRole('region', { name: '후보 칸' });
const titleH1 = () => screen.getAllByRole('heading', { level: 1 });

describe('여행 계획: 후보 칸 기본 접힘(1100px 미만)', () => {
  it('1099px에서는 접힌 채 시작하고, 1100px에서는 펼친 채 시작한다', async () => {
    await open(lib(), { width: 1099 });
    expect(candidates()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '후보 칸 펼치기' })).toBeInTheDocument();
    cleanup();
    await open(lib(), { width: 1100 });
    expect(candidates()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '후보 칸 접기' })).toBeInTheDocument();
  });

  it('1099px에서 사용자가 펼치면 다시 그려도(폭이 바뀌어도) 펼친 채다', async () => {
    const { setWidth } = await open(lib(), { width: 1099 });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '후보 칸 펼치기' }));
    expect(candidates()).toBeInTheDocument();
    setWidth(1000);
    expect(candidates()).toBeInTheDocument();
    setWidth(1099);
    expect(candidates()).toBeInTheDocument();
  });

  it('1100px 이상에서 사용자가 접으면 폭이 바뀌어도 접힌 채다', async () => {
    const { setWidth } = await open(lib(), { width: 1100 });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '후보 칸 접기' }));
    expect(candidates()).not.toBeInTheDocument();
    setWidth(1000);
    expect(candidates()).not.toBeInTheDocument();
  });

  it('화면을 다시 열면 기본값으로 돌아간다', async () => {
    await open(lib(), { width: 1099 });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '후보 칸 펼치기' }));
    expect(candidates()).toBeInTheDocument();
    cleanup();
    await open(lib(), { width: 1099 });
    expect(candidates()).not.toBeInTheDocument();
  });
});

describe('여행 계획: 후보 칸을 접고 펼치면 포커스가 맞은편 버튼으로 간다', () => {
  it('접기를 누르면(키보드) 펼치기 버튼으로 포커스가 간다', async () => {
    await open(lib(), { width: 1100 });
    const user = userEvent.setup();
    const collapse = screen.getByRole('button', { name: '후보 칸 접기' });
    collapse.focus();
    await user.keyboard('{Enter}');
    expect(candidates()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '후보 칸 펼치기' })).toHaveFocus();
  });

  it('펼치기를 누르면(키보드) 접기 버튼으로 포커스가 간다', async () => {
    await open(lib(), { width: 1099 });
    const user = userEvent.setup();
    const expand = screen.getByRole('button', { name: '후보 칸 펼치기' });
    expand.focus();
    await user.keyboard('{Enter}');
    expect(candidates()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '후보 칸 접기' })).toHaveFocus();
  });

  it('접고 펼치기를 되풀이해도 매번 맞은편으로 간다', async () => {
    await open(lib(), { width: 1100 });
    const user = userEvent.setup();
    for (let i = 0; i < 2; i += 1) {
      await user.click(screen.getByRole('button', { name: '후보 칸 접기' }));
      expect(screen.getByRole('button', { name: '후보 칸 펼치기' })).toHaveFocus();
      await user.click(screen.getByRole('button', { name: '후보 칸 펼치기' }));
      expect(screen.getByRole('button', { name: '후보 칸 접기' })).toHaveFocus();
    }
  });

  it('폭이 바뀌어 칸이 달라져도 포커스를 가져오지 않는다', async () => {
    const { setWidth } = await open(lib(), { width: 1099 });
    expect(document.body).toHaveFocus();
    setWidth(1200);
    expect(document.body).toHaveFocus();
  });
});

describe('여행 계획: 여행 제목 h1은 늘 하나', () => {
  it('1099px(후보 칸 접힘)에서는 눈에만 숨긴 h1 하나, 펼치면 보이는 h1 하나', async () => {
    await open(lib(), { width: 1099 });
    expect(titleH1()).toHaveLength(1);
    expect(titleH1()[0]).toHaveTextContent('강릉 여행');
    expect(candidates()).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '후보 칸 펼치기' }));
    expect(titleH1()).toHaveLength(1);
    expect(within(candidates()!).getByRole('heading', { level: 1 })).toHaveTextContent('강릉 여행');
  });

  it('1280px에서는 후보 칸의 보이는 h1 하나', async () => {
    await open(lib(), { width: 1280 });
    expect(titleH1()).toHaveLength(1);
    expect(within(candidates()!).getByRole('heading', { level: 1 })).toHaveTextContent('강릉 여행');
  });

  it('휴대폰: 후보 탭(보이는 h1)·Day 탭·접힘 어디서나 h1 하나', async () => {
    await open(lib(), { width: 375 });
    const user = userEvent.setup();
    const sheet = screen.getByRole('region', { name: '일정 시트' });
    expect(titleH1()).toHaveLength(1);
    expect(within(sheet).getByRole('heading', { level: 1 })).toHaveTextContent('강릉 여행');

    await user.click(within(sheet).getByRole('tab', { name: 'Day 1' }));
    expect(titleH1()).toHaveLength(1);
    expect(titleH1()[0]).toHaveTextContent('강릉 여행');

    await user.click(within(sheet).getByRole('button', { name: '시트 높이 바꾸기' }));
    await user.click(within(sheet).getByRole('button', { name: '시트 높이 바꾸기' }));
    expect(sheet).toHaveAttribute('data-snap', 'collapsed');
    expect(titleH1()).toHaveLength(1);
    expect(titleH1()[0]).toHaveTextContent('강릉 여행');
  });
});

describe('여행 계획 도움말', () => {
  it('중간 폭에서 후보 칸이 접혀도 도움말을 보여 주고 펼치면 제목 옆으로 옮긴다', async () => {
    await open(lib(), { width: 1099 });
    const map = screen.getByRole('region', { name: '지도' });
    expect(within(map).getByRole('link', { name: '도움말' })).toHaveAttribute(
      'href',
      '/help/trips',
    );
    expect(within(map).getAllByRole('link', { name: '도움말' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: '후보 칸 펼치기' }));
    expect(within(map).queryByRole('link', { name: '도움말' })).not.toBeInTheDocument();
    expect(within(candidates()!).getByRole('link', { name: '도움말' })).toHaveAttribute(
      'href',
      '/help/trips',
    );
  });

  it('휴대폰의 Day 탭과 접힌 시트에도 도움말 링크 하나를 남긴다', async () => {
    await open(lib(), { width: 375 });
    const user = userEvent.setup();
    const sheet = screen.getByRole('region', { name: '일정 시트' });
    expect(within(sheet).getAllByRole('link', { name: '도움말' })).toHaveLength(1);
    await user.click(within(sheet).getByRole('tab', { name: 'Day 1' }));
    expect(within(sheet).getByRole('link', { name: '도움말' })).toHaveAttribute(
      'href',
      '/help/trips',
    );
    await user.click(within(sheet).getByRole('button', { name: '시트 높이 바꾸기' }));
    await user.click(within(sheet).getByRole('button', { name: '시트 높이 바꾸기' }));
    expect(sheet).toHaveAttribute('data-snap', 'collapsed');
    expect(within(sheet).getAllByRole('link', { name: '도움말' })).toHaveLength(1);
    await user.click(within(sheet).getByRole('tab', { name: '후보 1' }));
    expect(within(sheet).getAllByRole('link', { name: '도움말' })).toHaveLength(1);
  });
});

describe('끌기 손잡이 크기', () => {
  it('여행 계획의 끌기 손잡이는 최소 44×44px', async () => {
    await open(lib(), { width: 1280 });
    const handles = screen.getAllByRole('button', { name: /끌어 옮기기$/ });
    expect(handles.length).toBeGreaterThan(0);
    for (const handle of handles) {
      const style = getComputedStyle(handle);
      expect(parseFloat(style.width)).toBeGreaterThanOrEqual(44);
      expect(parseFloat(style.minHeight || style.height)).toBeGreaterThanOrEqual(44);
    }
  });
});

describe('오늘 일정 버튼(스펙 §3.2)', () => {
  // 기본 여행은 2026-10-23~24(2일).
  const todayLink = () => screen.queryByRole('link', { name: '오늘 일정' });
  const mapPane = () => screen.getByRole('region', { name: '지도' });

  it('오늘이 기간 안이면 지도 칸에 보이고 /trips/<id>/today로 간다', async () => {
    vi.setSystemTime(new Date(2026, 9, 24, 9, 0, 0));
    await open(lib(), { width: 1280 });
    const link = within(mapPane()).getByRole('link', { name: '오늘 일정' });
    expect(link).toHaveAttribute('href', `/trips/${TRIP}/today`);
    expect(getComputedStyle(link).height).toBe('44px');
    expect(getComputedStyle(link).left).toBe('8px');
  });

  it('기간 밖(시작 전·끝난 뒤)이면 없다', async () => {
    await open(lib(), { width: 1280 });
    expect(todayLink()).not.toBeInTheDocument();
    cleanup();
    vi.setSystemTime(new Date(2026, 9, 25, 4, 0, 0));
    await open(lib(), { width: 1280 });
    expect(todayLink()).not.toBeInTheDocument();
  });

  it('휴대폰에서도 지도 칸에 보인다', async () => {
    vi.setSystemTime(new Date(2026, 9, 23, 9, 0, 0));
    await open(lib(), { width: 375 });
    expect(within(mapPane()).getByRole('link', { name: '오늘 일정' })).toBeInTheDocument();
  });

  it('중간 폭에서 후보 칸을 접으면 펼치기·도움말 버튼 오른쪽으로 비킨다', async () => {
    vi.setSystemTime(new Date(2026, 9, 23, 9, 0, 0));
    await open(lib(), { width: 1100 });
    expect(getComputedStyle(todayLink()!).left).toBe('8px');
    await userEvent.setup().click(screen.getByRole('button', { name: '후보 칸 접기' }));
    expect(screen.getByRole('button', { name: '후보 칸 펼치기' })).toBeInTheDocument();
    expect(getComputedStyle(todayLink()!).left).toBe('112px');
  });

  it('오프라인 안내와 겹치지 않게 안내를 버튼 아래로 내린다', async () => {
    // 기본 하네스는 경로 조회가 늘 OFFLINE이라 안내가 뜬다.
    vi.setSystemTime(new Date(2026, 9, 23, 9, 0, 0));
    await open(withTrip(plannerLibrary(), makeTrip({ stops: [[P1, P2]] })), { width: 375 });
    const notice = await within(mapPane()).findByText(
      '인터넷에 연결되지 않아 이동 시간은 어림값이에요',
    );
    expect(getComputedStyle(notice).top).toBe('60px');
  });
});
