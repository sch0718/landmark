import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { emptyLibrary } from 'src/schema/library';
import { VIRTUALIZE_AFTER } from 'src/sections/library/views/VirtualRows';
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
