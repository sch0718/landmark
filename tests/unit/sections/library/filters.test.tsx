import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { QUERY_PERSIST_DELAY_MS } from 'src/sections/library/use-library-query';
import { PREFS_KEY } from 'src/services/prefs-store';
import { L_CAFE, L_FOOD, makePlace, renderLibrary, sampleLibrary, withPlaces } from './fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

const labelChip = (name: string) =>
  within(screen.getByRole('group', { name: '라벨' })).getByRole('button', { name });
const visitChip = (name: string) =>
  within(screen.getByRole('group', { name: '방문' })).getByRole('button', { name });
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
          visited: 'all',
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

  it('안쪽 입력칸의 전역 바깥선은 꺼져 있어 상자의 바깥선만 보인다', async () => {
    await renderLibrary(sampleLibrary(), { prefs: LIST });
    const box = screen.getByRole('searchbox', { name: '장소 검색' }).closest('label')!;
    const classes = [...box.classList].map((name) => `.${name}`);
    const rules = [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
    const inner = rules.filter((rule) =>
      classes.some((name) => rule.selectorText === `${name} input:focus-visible`),
    );
    expect(inner.map((rule) => rule.style.getPropertyValue('outline'))).toEqual(['none']);
    const ring = rules.filter((rule) =>
      classes.some((name) => rule.selectorText === `${name}:focus-within`),
    );
    expect(ring.map((rule) => rule.style.getPropertyValue('outline'))).toEqual([
      '2px solid var(--tm-accent-text)',
    ]);
  });
});

/** 샘플 5곳 중 횟집(맛집·바다뷰) 한 곳만 다녀온 보관함. */
const withOneVisited = () =>
  withPlaces(sampleLibrary(), [
    makePlace(3, {
      name: '속초 횟집',
      address: '강원특별자치도 속초시 해맞이로 10',
      labelIds: [L_FOOD, 'label003'],
      visitedOn: '2026-10-01',
    }),
  ]);

describe('visit chips', () => {
  it('다녀온 곳이 없으면 방문 묶음을 그리지 않는다', async () => {
    await renderLibrary(sampleLibrary(), { prefs: LIST });
    expect(screen.queryByRole('group', { name: '방문' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: '라벨' })).toBeInTheDocument();
  });

  it('shows counts and filters to visited / unvisited places', async () => {
    const user = userEvent.setup();
    await renderLibrary(withOneVisited(), { prefs: LIST });

    expect(visitChip('안 가 본 곳 4')).toHaveAttribute('aria-pressed', 'false');
    expect(visitChip('가 본 곳 1')).toHaveAttribute('aria-pressed', 'false');
    expect(shown()).toHaveLength(5);

    await user.click(visitChip('가 본 곳 1'));
    expect(visitChip('가 본 곳 1')).toHaveAttribute('aria-pressed', 'true');
    expect(shownMatching('속초 횟집')).toBe(true);
    // 라벨 칩 숫자는 가 본 1곳 기준이다.
    expect(labelChip('맛집 1')).toBeInTheDocument();
    expect(labelChip('카페 0')).toBeInTheDocument();

    await user.click(visitChip('가 본 곳 1'));
    expect(visitChip('가 본 곳 1')).toHaveAttribute('aria-pressed', 'false');
    expect(shown()).toHaveLength(5);

    await user.click(visitChip('가 본 곳 1'));
    await user.click(visitChip('안 가 본 곳 4'));
    expect(visitChip('안 가 본 곳 4')).toHaveAttribute('aria-pressed', 'true');
    expect(visitChip('가 본 곳 1')).toHaveAttribute('aria-pressed', 'false');
  });

  it('안 가 본 곳은 4곳을 보이고 가 본 곳은 꺼진다', async () => {
    const user = userEvent.setup();
    await renderLibrary(withOneVisited(), { prefs: LIST });
    await user.click(visitChip('가 본 곳 1'));
    await user.click(visitChip('안 가 본 곳 4'));
    expect(shown()).toHaveLength(4);
    expect(visitChip('가 본 곳 1')).toHaveAttribute('aria-pressed', 'false');
  });

  it('counts visits inside the selected label', async () => {
    const user = userEvent.setup();
    await renderLibrary(withOneVisited(), { prefs: LIST });
    await user.click(labelChip('카페 1'));
    expect(visitChip('안 가 본 곳 1')).toBeInTheDocument();
    expect(visitChip('가 본 곳 0')).toBeInTheDocument();
    await user.click(labelChip('카페 1'));
    await user.click(labelChip('맛집 2'));
    expect(visitChip('안 가 본 곳 1')).toBeInTheDocument();
    expect(visitChip('가 본 곳 1')).toBeInTheDocument();
  });

  it('keeps the chips while a visit filter is on, and 필터 지우기 turns it off', async () => {
    const user = userEvent.setup();
    // 다녀온 곳이 없는데 선호에 `visited: 'visited'`가 남아 있는 보관함.
    await renderLibrary(sampleLibrary(), {
      prefs: {
        libraryView: 'list',
        query: {
          labelIds: [],
          mode: 'any',
          unlabeled: false,
          regions: [],
          text: '',
          visited: 'visited',
          sort: 'recent',
        },
      },
    });
    expect(visitChip('가 본 곳 0')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('조건에 맞는 장소가 없어요')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '필터 지우기' }));
    expect(shown()).toHaveLength(5);
    // 다녀온 곳이 없으니 필터가 꺼지면 묶음도 사라진다.
    expect(screen.queryByRole('group', { name: '방문' })).not.toBeInTheDocument();
  });
});

describe('visited sort', () => {
  const visitedLibrary = () =>
    withPlaces(sampleLibrary(), [
      makePlace(1, { name: '중앙시장 닭강정', labelIds: [L_FOOD], visitedOn: '2026-09-01' }),
      makePlace(2, { name: '안목 카페거리', labelIds: [L_CAFE], visitedOn: '2026-10-01' }),
    ]);

  it('sorts by visited date without persisting it, and the saved sorts switch it off', async () => {
    const storage = createMemoryStorage();
    await renderLibrary(visitedLibrary(), { prefs: LIST, storage });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // 가짜 시계 아래에서는 userEvent 대신 fireEvent로 누르고, 전환(setTimeout)은 직접 진행한다.
    const press = (el: HTMLElement) =>
      act(() => {
        fireEvent.click(el);
        vi.advanceTimersByTime(QUERY_PERSIST_DELAY_MS + 100);
      });

    press(screen.getByRole('button', { name: '최근 저장순' }));
    const item = screen.getByRole('menuitemradio', { name: '다녀온 날순' });
    expect(item).toHaveAttribute('aria-checked', 'false');
    press(item);

    expect(screen.getByRole('button', { name: '다녀온 날순' })).toBeInTheDocument();
    expect(shown().slice(0, 2)).toEqual([
      expect.stringContaining('안목 카페거리'),
      expect.stringContaining('중앙시장 닭강정'),
    ]);
    // 저장되는 정렬은 그대로다(옛 버전이 읽어도 선호가 깨지지 않는다).
    await act(async () => void (await Promise.resolve()));
    const saved = storage.getItem(PREFS_KEY);
    if (saved !== null) expect(JSON.parse(saved).query.sort).toBe('recent');

    press(screen.getByRole('button', { name: '다녀온 날순' }));
    expect(screen.getByRole('menuitemradio', { name: '다녀온 날순' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: '최근 저장순' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    press(screen.getByRole('menuitemradio', { name: '이름순' }));
    expect(screen.getByRole('button', { name: '이름순' })).toBeInTheDocument();
    expect(shown()[0]).toContain('강남 한 곳');
    await act(async () => void (await Promise.resolve()));
    expect(JSON.parse(storage.getItem(PREFS_KEY)!).query.sort).toBe('name');
  });

  it('does not save 다녀온 날순 into prefs even when another filter is changed', async () => {
    const storage = createMemoryStorage();
    await renderLibrary(visitedLibrary(), { prefs: LIST, storage });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const press = (el: HTMLElement) =>
      act(() => {
        fireEvent.click(el);
      });

    press(screen.getByRole('button', { name: '최근 저장순' }));
    press(screen.getByRole('menuitemradio', { name: '다녀온 날순' }));
    press(visitChip('가 본 곳 2'));
    await act(async () => {
      vi.advanceTimersByTime(QUERY_PERSIST_DELAY_MS + 100);
      await Promise.resolve();
    });
    const query = JSON.parse(storage.getItem(PREFS_KEY)!).query;
    expect(query.sort).toBe('recent');
    expect(query.visited).toBe('visited');
    expect(screen.getByRole('button', { name: '다녀온 날순' })).toBeInTheDocument();
  });

  it('keeps 다녀온 날순 on when 필터 지우기 clears the filters', async () => {
    const user = userEvent.setup();
    await renderLibrary(visitedLibrary(), { prefs: LIST });
    await user.click(screen.getByRole('button', { name: '최근 저장순' }));
    await user.click(screen.getByRole('menuitemradio', { name: '다녀온 날순' }));
    // 다녀온 카페(2개 중 1곳)를 '안 가 본 곳'으로 거르면 비어서 `필터 지우기`가 나온다.
    await user.click(screen.getByRole('button', { name: /^카페 / }));
    await user.click(screen.getByRole('button', { name: /^안 가 본 곳 / }));
    expect(screen.getByText('조건에 맞는 장소가 없어요')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '필터 지우기' }));
    expect(screen.getByRole('button', { name: '다녀온 날순' })).toBeInTheDocument();
    expect(shown().slice(0, 2)).toEqual([
      expect.stringContaining('안목 카페거리'),
      expect.stringContaining('중앙시장 닭강정'),
    ]);
  });

  it('starts over as the saved sort in a fresh store', async () => {
    const storage = createMemoryStorage();
    const user = userEvent.setup();
    await renderLibrary(visitedLibrary(), { prefs: LIST, storage });
    await user.click(screen.getByRole('button', { name: '최근 저장순' }));
    await user.click(screen.getByRole('menuitemradio', { name: '다녀온 날순' }));
    expect(screen.getByRole('button', { name: '다녀온 날순' })).toBeInTheDocument();
    cleanup();
    setAppRuntimeForTest(null);

    await renderLibrary(visitedLibrary(), { prefs: LIST, storage });
    expect(screen.getByRole('button', { name: '최근 저장순' })).toBeInTheDocument();
  });
});
