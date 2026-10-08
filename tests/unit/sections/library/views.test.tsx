import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { PREFS_KEY } from 'src/services/prefs-store';
import { L_FOOD, renderLibrary, sampleLibrary } from './fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

const overview = () => screen.queryByRole('group', { name: '라벨 개요' });
const placeList = () => screen.queryByRole('list', { name: '장소 목록' });
const block = (name: string | RegExp) =>
  within(screen.getByRole('group', { name: '라벨 개요' })).getByRole('button', { name });

describe('library views', () => {
  it('view switcher renders each of 4 views and persists choice', async () => {
    const user = userEvent.setup();
    const { storage } = await renderLibrary(sampleLibrary());
    const savedView = () => JSON.parse(storage.getItem(PREFS_KEY) ?? '{}').libraryView;
    const switcher = screen.getByRole('group', { name: '보기 방식' });
    const pick = (name: string) => user.click(within(switcher).getByRole('button', { name }));

    // 기본: 벤토. 필터가 없으면 라벨 블록만 보인다.
    expect(within(switcher).getByRole('button', { name: '벤토' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(overview()).toBeInTheDocument();
    expect(placeList()).not.toBeInTheDocument();

    await pick('카드');
    expect(overview()).not.toBeInTheDocument();
    // 카드는 메모를 보여 주고 라벨 칩이 붙는다.
    expect(within(placeList()!).getByText('비밀 메모: 창가 자리가 좋아요')).toBeInTheDocument();
    expect(within(placeList()!).getAllByRole('listitem')).toHaveLength(5);
    await waitFor(() => expect(savedView()).toBe('cards'));

    await pick('타일');
    expect(overview()).toBeInTheDocument();
    expect(getComputedStyle(overview()!).gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
    expect(placeList()).not.toBeInTheDocument();
    await waitFor(() => expect(savedView()).toBe('tiles'));

    await pick('목록');
    expect(overview()).not.toBeInTheDocument();
    expect(within(placeList()!).getAllByRole('listitem')).toHaveLength(5);
    // 목록은 한 줄 행이라 메모를 보이지 않는다.
    expect(screen.queryByText('비밀 메모: 창가 자리가 좋아요')).not.toBeInTheDocument();
    await waitFor(() => expect(savedView()).toBe('list'));

    await pick('벤토');
    expect(overview()).toBeInTheDocument();
    await waitFor(() => expect(savedView()).toBe('bento'));
  });

  it('restores the saved view on load', async () => {
    await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'cards' } });
    expect(placeList()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '카드' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('bento: the biggest label spans 2 rows and 미분류 comes last', async () => {
    await renderLibrary(sampleLibrary());
    const blocks = within(overview()!).getAllByRole('button');
    expect(blocks.map((b) => b.textContent)).toEqual([
      expect.stringContaining('맛집'),
      expect.stringContaining('카페'),
      expect.stringContaining('바다뷰'),
      expect.stringContaining('미분류'),
    ]);
    expect(blocks.map((b) => getComputedStyle(b).gridRow)).toEqual(['span 2', '', '', '']);
    expect(blocks[0]).toHaveTextContent('2곳');
    expect(blocks[3]).toHaveTextContent('2곳');
  });

  it('bento block selects label and shows list below', async () => {
    const user = userEvent.setup();
    const { storage } = await renderLibrary(sampleLibrary());

    await user.click(block(/^카페/));
    expect(block(/^카페/)).toHaveAttribute('aria-pressed', 'true');
    // 개요 보기를 유지한 채 그 아래에 장소 목록(ListView)이 나온다.
    expect(overview()).toBeInTheDocument();
    const items = within(placeList()!).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('안목 카페거리');
    // 라벨 칩도 같은 조건을 보여 준다.
    expect(
      within(screen.getByRole('group', { name: '라벨' })).getByRole('button', { name: '카페 1' }),
    ).toHaveAttribute('aria-pressed', 'true');

    // 다른 블록을 누르면 `[그 라벨]`로 바뀐다.
    await user.click(block(/^맛집/));
    expect(within(placeList()!).getAllByRole('listitem')).toHaveLength(2);
    await waitFor(() =>
      expect(JSON.parse(storage.getItem(PREFS_KEY)!).query.labelIds).toEqual([L_FOOD]),
    );

    // 같은 블록을 다시 누르면 푼다.
    await user.click(block(/^맛집/));
    expect(placeList()).not.toBeInTheDocument();
  });

  it('tile selects a label and 미분류 shows unlabeled places in a list below', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'tiles' } });

    await user.click(block(/^미분류/));
    const items = within(placeList()!).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('창가 자리'),
      expect.stringContaining('강남 한 곳'),
    ]);
  });

  it('opens the place page when a row is clicked', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    await user.click(within(placeList()!).getByRole('button', { name: /안목 카페거리/ }));
    expect(router.state.location.pathname).toBe('/place/place00002');
  });
});
