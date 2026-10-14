import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { PREFS_KEY } from 'src/services/prefs-store';
import { L_CAFE, L_FOOD, renderLibrary, sampleLibrary } from './fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

const labelChip = (name: string) =>
  within(screen.getByRole('group', { name: '라벨' })).getByRole('button', { name });
const regionChip = (name: string) =>
  within(screen.getByRole('group', { name: '지역' })).getByRole('button', { name });

/** 목록 보기에서 보이는 장소 이름들(행 순서대로). */
const shown = () =>
  within(screen.getByRole('list', { name: '장소 목록' }))
    .getAllByRole('button')
    .map((button) => button.textContent ?? '');
const shownMatching = (...names: string[]) =>
  names.every((name) => shown().some((text) => text.includes(name))) &&
  shown().length === names.length;

const LIST = { libraryView: 'list' as const };

describe('library filters', () => {
  it('label chips filter with any/all and show counts', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { prefs: LIST });

    expect(labelChip('맛집 2')).toBeInTheDocument();
    expect(labelChip('카페 1')).toBeInTheDocument();
    expect(labelChip('바다뷰 1')).toBeInTheDocument();
    expect(labelChip('미분류 2')).toBeInTheDocument();
    expect(shown()).toHaveLength(5);

    await user.click(labelChip('맛집 2'));
    expect(labelChip('맛집 2')).toHaveAttribute('aria-pressed', 'true');
    expect(shownMatching('중앙시장 닭강정', '속초 횟집')).toBe(true);

    // 여러 개를 고르면 기본은 하나라도 붙은 장소(any).
    await user.click(labelChip('바다뷰 1'));
    expect(shownMatching('중앙시장 닭강정', '속초 횟집')).toBe(true);

    // 모두 포함이면 두 라벨이 모두 붙은 장소만.
    await user.click(screen.getByRole('button', { name: '모두 포함' }));
    expect(screen.getByRole('button', { name: '모두 포함' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(shownMatching('속초 횟집')).toBe(true);
    // 라벨 칩의 숫자는 라벨 필터를 빼고 센다.
    expect(labelChip('맛집 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '모두 포함' }));
    expect(shownMatching('중앙시장 닭강정', '속초 횟집')).toBe(true);
  });

  it('unlabeled chip and label chips are mutually exclusive', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { prefs: LIST });

    await user.click(labelChip('맛집 2'));
    await user.click(labelChip('카페 1'));
    expect(labelChip('맛집 2')).toHaveAttribute('aria-pressed', 'true');
    expect(labelChip('카페 1')).toHaveAttribute('aria-pressed', 'true');

    // 미분류를 고르면 라벨 선택이 비워진다.
    await user.click(labelChip('미분류 2'));
    expect(labelChip('미분류 2')).toHaveAttribute('aria-pressed', 'true');
    expect(labelChip('맛집 2')).toHaveAttribute('aria-pressed', 'false');
    expect(labelChip('카페 1')).toHaveAttribute('aria-pressed', 'false');
    expect(shownMatching('강남 한 곳', '창가 자리')).toBe(true);

    // 라벨을 고르면 미분류가 꺼진다.
    await user.click(labelChip('카페 1'));
    expect(labelChip('미분류 2')).toHaveAttribute('aria-pressed', 'false');
    expect(labelChip('카페 1')).toHaveAttribute('aria-pressed', 'true');
    expect(shownMatching('안목 카페거리')).toBe(true);
  });

  it('region chips filter', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { prefs: LIST });

    // regionCounts 순서: 개수 내림차순, 같으면 이름순.
    const order = within(screen.getByRole('group', { name: '지역' }))
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(order).toEqual(['강릉 3', '서울 1', '속초 1']);

    await user.click(regionChip('속초 1'));
    expect(shownMatching('속초 횟집')).toBe(true);

    // 여러 지역은 OR.
    await user.click(regionChip('서울 1'));
    expect(shownMatching('속초 횟집', '강남 한 곳')).toBe(true);

    await user.click(regionChip('속초 1'));
    await user.click(regionChip('서울 1'));
    expect(shown()).toHaveLength(5);
  });

  it('search filters by memo text', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { prefs: LIST });

    const search = screen.getByPlaceholderText('이름·주소·메모·라벨 검색');
    await user.type(search, '비밀');
    expect(shownMatching('창가 자리')).toBe(true);
    // 칩 숫자도 검색을 따른다.
    expect(labelChip('미분류 1')).toBeInTheDocument();
    expect(labelChip('맛집 0')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, '바다뷰');
    expect(shownMatching('속초 횟집')).toBe(true); // 라벨 이름으로도 찾는다.
  });

  it('applies the in-memory query at once and persists it after 300ms', async () => {
    const user = userEvent.setup();
    const { storage } = await renderLibrary(sampleLibrary(), { prefs: LIST });

    await user.click(labelChip('카페 1'));
    expect(shownMatching('안목 카페거리')).toBe(true);
    // 화면은 바로 바뀌지만 저장은 디바운스 뒤에 한다.
    const savedQuery = () => JSON.parse(storage.getItem(PREFS_KEY)!).query;
    expect(savedQuery().labelIds).toEqual([]);
    await waitFor(() => expect(savedQuery().labelIds).toEqual([L_CAFE]));
  });

  it('prunes label ids that are no longer live before filtering', async () => {
    await renderLibrary(sampleLibrary(), {
      prefs: {
        libraryView: 'list',
        query: {
          labelIds: ['label999', L_FOOD],
          mode: 'all',
          unlabeled: false,
          regions: [],
          text: '',
          sort: 'recent',
        },
      },
    });
    // 없는 라벨이 '모두 포함'에 남아 목록을 비우지 않는다: 맛집만 걸린다.
    expect(shownMatching('중앙시장 닭강정', '속초 횟집')).toBe(true);
    expect(labelChip('맛집 2')).toHaveAttribute('aria-pressed', 'true');
    expect(labelChip('바다뷰 1')).toHaveAttribute('aria-pressed', 'false');
  });

  it('sorts by name and by label from the sort menu', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { prefs: LIST });

    expect(shown()[0]).toContain('창가 자리'); // 최근 저장순
    await user.click(screen.getByRole('button', { name: '최근 저장순' }));
    await user.click(screen.getByRole('menuitemradio', { name: '이름순' }));
    expect(shown()[0]).toContain('강남 한 곳');
    expect(screen.getByRole('button', { name: '이름순' })).toBeInTheDocument();
  });
});

describe('library search box', () => {
  it('상자 전체가 label이라 돋보기·여백을 눌러도 입력칸에 포커스가 간다', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { prefs: LIST });
    const input = screen.getByRole('searchbox', { name: '장소 검색' });
    const box = input.closest('label');
    expect(box).not.toBeNull();
    await user.click(box!);
    expect(input).toHaveFocus();
  });
});
