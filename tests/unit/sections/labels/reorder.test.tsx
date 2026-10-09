import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { liveLabels } from 'src/domain/library/query';
import type { Library } from 'src/schema/library';
import { LIBRARY_KEY } from 'src/services/library-store';
import { L_CAFE, L_FOOD, L_SEA, renderLibrary, sampleLibrary } from '../library/fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ROW_HEIGHT = 56;

/** jsdom은 배치를 하지 않으므로 줄마다 56px 높이의 사각형을 돌려줘 dnd-kit이 위치를 계산하게 한다. */
function stubLayout() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const item = this.closest('li');
    const list = item?.parentElement;
    const index = item && list ? [...list.children].indexOf(item) : 0;
    const top = item ? index * ROW_HEIGHT : 0;
    return {
      x: 0,
      y: top,
      top,
      left: 0,
      right: 320,
      bottom: top + ROW_HEIGHT,
      width: 320,
      height: ROW_HEIGHT,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

const stored = (storage: Storage) => JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library;

describe('label reorder', () => {
  it('reorder by keyboard sensor persists order', async () => {
    stubLayout();
    const user = userEvent.setup();
    const { storage } = await renderLibrary(sampleLibrary(), { path: '/labels' });
    const handle = screen.getByRole('button', { name: '‘맛집’ 순서 바꾸기' });
    handle.focus();
    await user.keyboard(' ');
    await user.keyboard('{ArrowDown}');
    await user.keyboard(' ');

    await waitFor(() =>
      expect(liveLabels(stored(storage)).map((l) => l.id)).toEqual([L_CAFE, L_FOOD, L_SEA]),
    );
    const names = within(screen.getByRole('list', { name: '라벨 목록' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(names[0]).toContain('카페');
    expect(names[1]).toContain('맛집');
  });

  it('Escape cancels a keyboard drag without saving', async () => {
    stubLayout();
    const user = userEvent.setup();
    const { storage } = await renderLibrary(sampleLibrary(), { path: '/labels' });
    screen.getByRole('button', { name: '‘카페’ 순서 바꾸기' }).focus();
    await user.keyboard(' ');
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{Escape}');
    expect(liveLabels(stored(storage)).map((l) => l.id)).toEqual([L_FOOD, L_CAFE, L_SEA]);
  });
});
