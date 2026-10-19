import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { emptyLibrary } from 'src/schema/library';
import { VIRTUALIZE_AFTER } from 'src/sections/library/views/VirtualRows';
import { focusPlaceAtom } from 'src/stores/library-ui';
import { installMapResources } from '../../components/helpers/map-resources';
import { makePlace, renderLibrary, sampleLibrary, withPlaces } from './fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

const placeList = () => screen.getByRole('list', { name: '장소 목록' });

describe('library empty states', () => {
  it('empty states', async () => {
    const user = userEvent.setup();
    const empty = await renderLibrary(emptyLibrary());
    expect(screen.getByText('아직 저장한 장소가 없어요')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '옛 여행 가져오기' }));
    expect(empty.router.state.location.pathname).toBe('/settings');
    cleanup();

    await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    expect(screen.queryByText('조건에 맞는 장소가 없어요')).not.toBeInTheDocument();
    const search = screen.getByPlaceholderText('이름·주소·메모·라벨 검색');
    await user.type(search, '없는 장소 이름');
    expect(screen.getByText('조건에 맞는 장소가 없어요')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '장소 목록' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '필터 지우기' }));
    expect(search).toHaveValue('');
    expect(within(placeList()).getAllByRole('listitem')).toHaveLength(5);
  });

  it('shows the filter-empty state under the label overview in bento', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary());
    await user.type(screen.getByPlaceholderText('이름·주소·메모·라벨 검색'), '없는 장소 이름');
    expect(screen.getByRole('group', { name: '라벨 개요' })).toBeInTheDocument();
    expect(screen.getByText('조건에 맞는 장소가 없어요')).toBeInTheDocument();
  });
});

describe('library long text', () => {
  const LONG_NAME = '가'.repeat(300);
  const EMOJI_MEMO = '👨‍👩‍👧‍👦🌊'.repeat(120) + ' 끝';

  const longLibrary = () =>
    withPlaces(emptyLibrary(), [makePlace(1, { name: LONG_NAME, memo: EMOJI_MEMO })]);

  it('long name and memo do not overflow card', async () => {
    await renderLibrary(longLibrary(), { prefs: { libraryView: 'cards' } });
    const card = within(placeList()).getByRole('button');
    const name = card.querySelector<HTMLElement>('[data-part="name"]')!;
    const memo = card.querySelector<HTMLElement>('[data-part="memo"]')!;

    // 글자를 자르지 않고(서로게이트·ZWJ 이모지 보존) 전부 DOM에 둔 채 CSS로 줄바꿈·말줄임한다.
    expect(name.textContent).toBe(LONG_NAME);
    expect(memo.textContent).toBe(EMOJI_MEMO.trim());

    for (const el of [name, memo]) {
      const style = getComputedStyle(el);
      expect(style.overflowWrap).toBe('anywhere');
      expect(style.overflow).toBe('hidden');
      expect(style.textOverflow).toBe('ellipsis');
    }
    expect(getComputedStyle(memo).getPropertyValue('-webkit-line-clamp')).toBe('3'); // 메모 3줄
    expect(getComputedStyle(name).getPropertyValue('-webkit-line-clamp')).toBe('2');
    expect(getComputedStyle(card).minWidth).toBe('0px');
    // jsdom에는 레이아웃이 없어 스타일만 단언한다. 실제 폭 초과는 브라우저에서 눈으로 확인한다.
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
  });

  it('card shows the memo right below the name, large, in the primary text color (spec 5.2)', async () => {
    await renderLibrary(
      withPlaces(emptyLibrary(), [makePlace(1, { name: '안목 카페', memo: '창가 자리가 좋아요' })]),
      { prefs: { libraryView: 'cards' } },
    );
    const card = within(placeList()).getByRole('button');
    const name = card.querySelector<HTMLElement>('[data-part="name"]')!;
    const memo = card.querySelector<HTMLElement>('[data-part="memo"]')!;
    const region = card.querySelector<HTMLElement>('[data-part="region"]')!;

    expect(name.nextElementSibling).toBe(memo);
    const style = getComputedStyle(memo);
    expect(style.fontSize).toBe('16px');
    expect(style.color).toBe('var(--tm-text-primary)');
    // 지역은 메모 뒤에, 메모보다 작고 흐리게 놓인다.
    expect(memo.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getComputedStyle(region).fontSize).toBe('12px');
  });

  it('shows the region borrowed from a nearby addressed place when the address is empty', async () => {
    const near = {
      ...makePlace(2, { name: '주소 없는 곳', address: '' }),
      lng: 128.96,
      lat: 37.78,
    };
    await renderLibrary(
      withPlaces(emptyLibrary(), [makePlace(1, { name: '주소 있는 곳' }), near]),
      { prefs: { libraryView: 'list' } },
    );
    const row = within(placeList()).getByRole('button', { name: /주소 없는 곳/ });
    expect(row).toHaveTextContent('강릉');
    expect(row).not.toHaveTextContent('기타');
  });

  it('long name ellipsizes on a single line in the list row', async () => {
    await renderLibrary(longLibrary(), { prefs: { libraryView: 'list' } });
    const row = within(placeList()).getByRole('button');
    const name = row.firstElementChild as HTMLElement;
    expect(name.textContent).toBe(LONG_NAME);
    const style = getComputedStyle(name);
    expect(style.whiteSpace).toBe('nowrap');
    expect(style.textOverflow).toBe('ellipsis');
    expect(style.overflow).toBe('hidden');
    expect(style.minWidth).toBe('0px');
  });
});

describe('library virtualization', () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  beforeEach(() => {
    // jsdom에는 레이아웃이 없어 가상화가 크기를 알 수 없다. 스크롤 칸 600px, 줄 57px로 속인다.
    for (const key of ['offsetHeight', 'offsetWidth'] as const) {
      originals.set(key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key));
    }
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.index === undefined ? 600 : 57;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 360,
    });
  });
  afterEach(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
    }
  });

  const many = (count: number) =>
    withPlaces(
      emptyLibrary(),
      Array.from({ length: count }, (_, i) => makePlace(i + 1, { name: `장소 ${i + 1}` })),
    );

  it('renders every row up to the threshold', async () => {
    await renderLibrary(many(VIRTUALIZE_AFTER), { prefs: { libraryView: 'list' } });
    expect(within(placeList()).getAllByRole('listitem')).toHaveLength(VIRTUALIZE_AFTER);
  });

  it('renders only the visible window of a long list and follows scrolling', async () => {
    await renderLibrary(many(300), { prefs: { libraryView: 'list' } });
    const rows = () => within(placeList()).getAllByRole('listitem');
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(rows().length).toBeLessThan(40);
    // 최근 저장순이라 맨 위는 마지막으로 저장한 장소.
    expect(rows()[0]).toHaveTextContent('장소 300');
    expect(placeList().style.height || getComputedStyle(placeList()).height).toBe(`${300 * 57}px`);

    const scroller = placeList().parentElement!.parentElement!;
    scroller.scrollTop = 57 * 150;
    fireEvent.scroll(scroller);
    await waitFor(() => expect(screen.queryByText('장소 300')).not.toBeInTheDocument());
    expect(screen.getByText('장소 150')).toBeInTheDocument();
  });
});

describe('닫으면 목록 스크롤 되돌리기', () => {
  // 보관함과 함께 그려지는 지도 칸이 가짜 어댑터로 뜨게 한다.
  let resources: ReturnType<typeof installMapResources>;
  beforeEach(() => {
    vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
    resources = installMapResources();
  });
  afterEach(() => {
    resources.restore();
    vi.unstubAllEnvs();
  });

  /** 목록을 감싼 가장 가까운 스크롤 칸. */
  const scroller = () => {
    let el: HTMLElement | null = screen.getByRole('list', { name: '장소 목록' });
    while (el !== null && getComputedStyle(el).overflow !== 'auto') el = el.parentElement;
    return el!;
  };
  const id = (n: number) => `place${String(n).padStart(5, '0')}`;
  const detail = () => within(screen.getByRole('region', { name: '장소 상세' }));
  /** 경로 전환은 transition으로 그려지므로, 상세가 그 장소로 바뀔 때까지 기다린다. */
  const openPlace = async (
    router: Awaited<ReturnType<typeof renderLibrary>>['router'],
    n: number,
    name: string,
  ) => {
    await router.navigate(`/place/${id(n)}`);
    await waitFor(() => expect(detail().getByRole('heading', { name })).toBeInTheDocument());
  };
  const closeDetail = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(detail().getByRole('button', { name: '닫기' }));
  };

  it('마커로 열어 목록이 움직였어도 닫으면 열기 전 자리로 돌아간다', async () => {
    const user = userEvent.setup();
    const { router, store } = await renderLibrary(sampleLibrary(), {
      prefs: { libraryView: 'bento' },
    });
    const box = scroller();
    box.scrollTop = 120;
    fireEvent.scroll(box);
    // 마커를 누르면 목록 스크롤 요청이 먼저 오고 목록이 그 행으로 움직인다(여기서는 흉내).
    act(() => store.set(focusPlaceAtom, { id: id(3), seq: 99 }));
    box.scrollTop = 400;
    fireEvent.scroll(box);
    await openPlace(router, 3, '속초 횟집');

    await closeDetail(user);

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(box.scrollTop).toBe(120);
  });

  it('열린 사이 거르기가 바뀌면 되돌리지 않는다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    const box = scroller();
    box.scrollTop = 120;
    fireEvent.scroll(box);
    await openPlace(router, 3, '속초 횟집');
    await user.type(screen.getByRole('searchbox', { name: '장소 검색' }), '횟집');
    box.scrollTop = 30;
    fireEvent.scroll(box);

    await closeDetail(user);

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(box.scrollTop).toBe(30);
  });

  it('거르기가 바뀐 채 닫은 뒤 다시 열고 닫아도 옛 자리로 튀지 않는다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    const box = scroller();
    box.scrollTop = 120;
    fireEvent.scroll(box);
    await openPlace(router, 3, '속초 횟집');
    await user.type(screen.getByRole('searchbox', { name: '장소 검색' }), '횟집');
    // 브라우저가 거르기에 맞춰 자리를 줄이지만 scroll 이벤트는 오지 않는 경우.
    box.scrollTop = 0;
    await closeDetail(user);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));

    await openPlace(router, 4, '강남 한 곳');
    await closeDetail(user);

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(box.scrollTop).toBe(0);
  });

  it('열리지 못한 스크롤 요청 뒤 사용자가 직접 스크롤하면 그 자리를 기억한다', async () => {
    const user = userEvent.setup();
    const { router, store } = await renderLibrary(sampleLibrary(), {
      prefs: { libraryView: 'list' },
    });
    const box = scroller();
    box.scrollTop = 120;
    fireEvent.scroll(box);
    // 요청만 오고 장소는 열리지 않는다.
    act(() => store.set(focusPlaceAtom, { id: id(3), seq: 99 }));
    fireEvent.wheel(box);
    box.scrollTop = 200;
    fireEvent.scroll(box);
    await openPlace(router, 3, '속초 횟집');
    box.scrollTop = 400;
    fireEvent.scroll(box);

    await closeDetail(user);

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(box.scrollTop).toBe(200);
  });

  it('열린 채 다른 장소로 옮겨도 닫으면 처음 자리로 돌아간다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    const box = scroller();
    box.scrollTop = 120;
    fireEvent.scroll(box);
    await openPlace(router, 3, '속초 횟집');
    box.scrollTop = 400;
    fireEvent.scroll(box);
    await openPlace(router, 4, '강남 한 곳');
    box.scrollTop = 500;
    fireEvent.scroll(box);

    await closeDetail(user);

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(box.scrollTop).toBe(120);
  });

  it('브라우저 뒤로가기로 닫아도 되돌린다', async () => {
    const { router } = await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    const box = scroller();
    box.scrollTop = 120;
    fireEvent.scroll(box);
    await openPlace(router, 3, '속초 횟집');
    box.scrollTop = 400;
    fireEvent.scroll(box);

    await act(() => router.navigate(-1));

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(() => expect(box.scrollTop).toBe(120));
  });
});
