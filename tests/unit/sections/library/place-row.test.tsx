import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { PlaceCard } from 'src/sections/library/PlaceCard';
import { PlaceRow } from 'src/sections/library/PlaceRow';
import {
  L_CAFE,
  L_FOOD,
  L_SEA,
  makePlace,
  renderLibrary,
  sampleLibrary,
  withPlaces,
} from './fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const placeList = () => screen.getByRole('list', { name: '장소 목록' });
const rowOf = (name: RegExp) => within(placeList()).getByRole('button', { name });

describe('place row labels', () => {
  it('shows the label names as chips, at most 2, then +N', async () => {
    const library = withPlaces(sampleLibrary(), [
      makePlace(6, { name: '라벨 셋', labelIds: [L_FOOD, L_CAFE, L_SEA] }),
    ]);
    await renderLibrary(library, { prefs: { libraryView: 'list' } });

    const two = rowOf(/속초 횟집/);
    expect(two).toHaveTextContent('맛집');
    expect(two).toHaveTextContent('바다뷰');
    expect(two).not.toHaveTextContent('+');

    const three = rowOf(/라벨 셋/);
    expect(three).toHaveTextContent('맛집');
    expect(three).toHaveTextContent('카페');
    expect(three).not.toHaveTextContent('바다뷰');
    expect(three).toHaveTextContent('+1');
    // 지역은 그대로 보인다.
    expect(three).toHaveTextContent('강릉');
  });

  it('paints a chip with the label palette and shows nothing for an unlabeled place', async () => {
    await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    const chip = within(rowOf(/안목 카페거리/)).getByText('카페');
    expect(getComputedStyle(chip).backgroundColor).toBe('var(--tm-label-yellow-fill)');
    expect(getComputedStyle(chip).color).toBe('var(--tm-label-yellow-text)');
    expect(getComputedStyle(chip).whiteSpace).toBe('nowrap');
    expect(rowOf(/강남 한 곳/)).not.toHaveTextContent('카페');
  });

  it('the row shows a label right after it is added in the detail', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), {
      path: '/place/place00004',
      prefs: { libraryView: 'list' },
    });
    expect(rowOf(/강남 한 곳/)).not.toHaveTextContent('카페');

    const detail = screen.getByRole('region', { name: '장소 상세' });
    await user.click(within(detail).getByRole('button', { name: '카페' }));

    await waitFor(() => expect(rowOf(/강남 한 곳/)).toHaveTextContent('카페'));
  });
});

describe('overview views always list the places', () => {
  it('bento without a filter shows every place under the blocks', async () => {
    await renderLibrary(sampleLibrary());
    expect(screen.getByRole('group', { name: '라벨 개요' })).toBeInTheDocument();
    expect(within(placeList()).getAllByRole('listitem')).toHaveLength(5);
  });

  it('tiles without a filter shows every place under the blocks', async () => {
    await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'tiles' } });
    expect(within(placeList()).getAllByRole('listitem')).toHaveLength(5);
  });
});

describe('open place in the list', () => {
  it('marks only the open place row as current', async () => {
    await renderLibrary(sampleLibrary(), {
      path: '/place/place00002',
      prefs: { libraryView: 'list' },
    });
    expect(rowOf(/안목 카페거리/)).toHaveAttribute('aria-current', 'true');
    expect(rowOf(/속초 횟집/)).not.toHaveAttribute('aria-current');
  });

  it('marks it under bento too, and follows the route', async () => {
    const { router } = await renderLibrary(sampleLibrary(), { path: '/place/place00002' });
    expect(rowOf(/안목 카페거리/)).toHaveAttribute('aria-current', 'true');
    await router.navigate('/place/place00003');
    await waitFor(() => expect(rowOf(/속초 횟집/)).toHaveAttribute('aria-current', 'true'));
    expect(rowOf(/안목 카페거리/)).not.toHaveAttribute('aria-current');
  });

  it('scrolls the row into view when the place opens', async () => {
    const scrolled = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrolled,
    });
    try {
      await renderLibrary(sampleLibrary(), {
        path: '/place/place00003',
        prefs: { libraryView: 'list' },
      });
      await waitFor(() => expect(scrolled).toHaveBeenCalled());
      expect(scrolled.mock.contexts.at(-1)).toBe(rowOf(/속초 횟집/).closest('li'));
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });
});

describe('place row visited mark', () => {
  it('다녀온 장소 버튼의 접근성 이름에 다녀옴이 들어가고 안 가 본 곳에는 없다', async () => {
    const library = withPlaces(sampleLibrary(), [
      makePlace(6, { name: '경포대', visitedOn: '2026-10-12' }),
      makePlace(7, { name: '지운 곳', visitedOn: null }),
    ]);
    await renderLibrary(library, { prefs: { libraryView: 'list' } });

    const visited = rowOf(/경포대/);
    expect(visited).toHaveAccessibleName(expect.stringContaining('다녀옴'));
    expect(visited.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(rowOf(/지운 곳/)).not.toHaveAccessibleName(expect.stringContaining('다녀옴'));
    expect(rowOf(/속초 횟집/)).not.toHaveAccessibleName(expect.stringContaining('다녀옴'));
  });
});

describe('place row distance', () => {
  const itemProps = {
    place: makePlace(1, { name: '중앙시장 닭강정' }),
    region: '강릉시',
    labels: [],
    selecting: false,
    selected: false,
    onOpen: vi.fn(),
    onToggle: vi.fn(),
  };

  it('행은 지역 자리에 직선거리를 보이고 화면 읽기에는 내 위치에서를 붙인다', () => {
    render(<PlaceRow {...itemProps} distanceM={567.7} />);
    const row = screen.getByRole('button');
    expect(row).toHaveTextContent('570m');
    expect(row).not.toHaveTextContent('강릉시');
    expect(row).toHaveAccessibleName(expect.stringContaining('내 위치에서 570m'));
    expect(screen.getByText('내 위치에서')).toHaveStyle({ position: 'absolute' });
  });

  it('거리가 없으면 지역 그대로', () => {
    render(<PlaceRow {...itemProps} />);
    expect(screen.getByRole('button')).toHaveTextContent('강릉시');
    expect(screen.getByRole('button')).not.toHaveAccessibleName(
      expect.stringContaining('내 위치에서'),
    );
  });

  it('카드도 지역 자리에 거리를 보인다', () => {
    render(<PlaceCard {...itemProps} distanceM={2435} />);
    const card = screen.getByRole('button');
    expect(card).toHaveTextContent('2.4km');
    expect(card).not.toHaveTextContent('강릉시');
    expect(card).toHaveAccessibleName(expect.stringContaining('내 위치에서 2.4km'));
  });
});
