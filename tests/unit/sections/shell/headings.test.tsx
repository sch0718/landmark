import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { AppProviders } from 'src/app';
import type { Library } from 'src/schema/library';
import { addFlowAtom } from 'src/stores/add-place';
import { renderLibrary, sampleLibrary, T0 } from '../library/fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
  document.title = '';
});

const P1 = 'place00001'; // 중앙시장 닭강정
const TRIP = 'trip000001';

const f = <V,>(value: V) => ({ value, updatedAt: T0 });

function withTrip(base: Library, deletedAt: string | null = null): Library {
  return {
    ...base,
    trips: {
      [TRIP]: {
        id: TRIP,
        title: f('강릉 여행'),
        startDate: f('2026-10-23'),
        endDate: f('2026-10-24'),
        origin: f<string | null>(null),
        candidates: f<string[]>([]),
        days: [0, 1].map(() => ({
          stops: f([]),
          lodging: f<string | null>(null),
          startTime: f('09:00'),
        })),
        legModes: f({}),
        createdAt: T0,
        deletedAt,
      },
    },
  };
}

const h1s = () => screen.getAllByRole('heading', { level: 1 });

describe('화면별 제목 구조', () => {
  it.each([
    ['/', 1280, '보관함'],
    ['/', 390, '보관함'],
    ['/map', 1280, '지도'],
    ['/map', 390, '지도'],
  ])('%s (%i px)는 h1이 하나이고 "%s"다', async (path, width, name) => {
    await renderLibrary(sampleLibrary(), { path, width });
    expect(h1s().map((h) => h.textContent)).toEqual([name]);
  });

  it('보관함·지도의 h1은 화면에 보이지 않게 가린다', async () => {
    await renderLibrary(sampleLibrary(), { path: '/' });
    const style = getComputedStyle(h1s()[0]!);
    expect(style.position).toBe('absolute');
    expect(style.width).toBe('1px');
    expect(style.height).toBe('1px');
  });

  it.each([1280, 1279, 390])(
    '장소 상세(%i px)는 장소 이름이 h1이고 라벨·메모가 h2다',
    async (width) => {
      await renderLibrary(sampleLibrary(), { path: `/place/${P1}`, width });
      expect(h1s().map((h) => h.textContent)).toEqual(['중앙시장 닭강정']);
      const detail = screen.getByRole('region', { name: '장소 상세' });
      expect(
        within(detail)
          .getAllByRole('heading', { level: 2 })
          .map((h) => h.textContent),
      ).toEqual(['라벨', '메모']);
      expect(within(detail).queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
      // 이름을 고치는 버튼은 그대로 있다.
      expect(within(detail).getByRole('button', { name: '이름 수정' })).toBeInTheDocument();
    },
  );

  it('이름을 고치는 입력칸이 열려 있어도 제목 이름은 지금 장소 이름이다', async () => {
    await renderLibrary(sampleLibrary(), { path: `/place/${P1}` });
    await userEvent.setup().click(screen.getByRole('button', { name: '이름 수정' }));
    expect(screen.getByRole('textbox', { name: '이름' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '중앙시장 닭강정' })).toBeInTheDocument();
    expect(h1s()).toHaveLength(1);
  });

  it.each([1280, 1024])(
    '장소 상세(%i px) 자리를 추가 칸이 대신 차지해도 장소 이름 h1 하나가 남는다',
    async (width) => {
      const { store } = await renderLibrary(sampleLibrary(), { path: `/place/${P1}`, width });
      expect(screen.getByRole('region', { name: '장소 상세' })).toBeInTheDocument();
      act(() => store.set(addFlowAtom, { step: 'link', hint: 'place' }));
      await screen.findByRole('region', { name: '장소 추가' });
      expect(screen.queryByRole('region', { name: '장소 상세' })).not.toBeInTheDocument();
      expect(h1s().map((h) => h.textContent)).toEqual(['중앙시장 닭강정']);
      // 눈에만 숨긴다.
      expect(getComputedStyle(h1s()[0]!).width).toBe('1px');
    },
  );

  it('중간 폭에서 핀 모드가 상세 오버레이를 내려도 장소 이름 h1 하나가 남는다', async () => {
    const { store } = await renderLibrary(sampleLibrary(), { path: `/place/${P1}`, width: 1024 });
    act(() => store.set(addFlowAtom, { step: 'pin', name: '', start: null }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('region', { name: '장소 상세' })).not.toBeInTheDocument(),
    );
    expect(h1s().map((h) => h.textContent)).toEqual(['중앙시장 닭강정']);
  });

  it('찾을 수 없는 장소도 h1이 하나다', async () => {
    await renderLibrary(sampleLibrary(), { path: '/place/nothere000', width: 390 });
    expect(h1s().map((h) => h.textContent)).toEqual(['장소를 찾을 수 없어요']);
  });

  it.each([
    ['/labels', '라벨 관리'],
    ['/settings', '설정'],
    ['/trips', '여행'],
  ])('%s는 h1이 하나이고 "%s"다', async (path, name) => {
    await renderLibrary(sampleLibrary(), { path });
    expect(h1s().map((h) => h.textContent)).toEqual([name]);
  });

  it('여행 계획 화면은 여행 제목이 h1이다', async () => {
    await renderLibrary(withTrip(sampleLibrary()), { path: `/trips/${TRIP}` });
    expect(h1s().map((h) => h.textContent)).toEqual(['강릉 여행']);
  });

  it('여행 카드 제목은 h2다', async () => {
    await renderLibrary(withTrip(sampleLibrary()), { path: '/trips' });
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '강릉 여행' })).toBeInTheDocument();
  });
});

describe('탭 제목', () => {
  it.each([
    ['/', '보관함 · 랜드마크'],
    ['/map', '지도 · 랜드마크'],
    [`/place/${P1}`, '중앙시장 닭강정 · 랜드마크'],
    ['/labels', '라벨 관리 · 랜드마크'],
    ['/settings', '설정 · 랜드마크'],
    ['/trips', '여행 · 랜드마크'],
  ])('%s → %s', async (path, title) => {
    await renderLibrary(sampleLibrary(), { path });
    expect(document.title).toBe(title);
  });

  it('여행 계획 화면은 여행 제목을 쓴다', async () => {
    await renderLibrary(withTrip(sampleLibrary()), { path: `/trips/${TRIP}` });
    expect(document.title).toBe('강릉 여행 · 랜드마크');
  });

  it('찾지 못한 장소·여행은 "랜드마크"다', async () => {
    await renderLibrary(sampleLibrary(), { path: '/place/nothere000' });
    expect(document.title).toBe('랜드마크');
    cleanup();
    document.title = '이전 화면';
    await renderLibrary(sampleLibrary(), { path: `/trips/${TRIP}` });
    expect(document.title).toBe('랜드마크');
    cleanup();
    document.title = '이전 화면';
    await renderLibrary(withTrip(sampleLibrary(), T0), { path: `/trips/${TRIP}` });
    expect(document.title).toBe('랜드마크');
  });

  it('화면을 옮기면 제목이 따라 바뀐다', async () => {
    const { router } = await renderLibrary(sampleLibrary(), { path: '/', width: 390 });
    expect(document.title).toBe('보관함 · 랜드마크');
    await act(() => router.navigate('/settings'));
    expect(await screen.findByRole('heading', { name: '설정' })).toBeInTheDocument();
    expect(document.title).toBe('설정 · 랜드마크');
    await act(() => router.navigate('/map'));
    expect(document.title).toBe('지도 · 랜드마크');
  });
});

describe('알림 영역', () => {
  it('이름이 "알림"이다', () => {
    render(
      <AppProviders>
        <div />
      </AppProviders>,
    );
    expect(document.querySelector('section[aria-label="알림"]')).not.toBeNull();
    expect(document.querySelector('section[aria-label^="Notifications"]')).toBeNull();
  });
});
