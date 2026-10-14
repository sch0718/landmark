import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { renderLibrary, sampleLibrary } from './fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
});

/** 글자에 투명도를 얹으면 칩 바탕 위 대비가 AA(4.5:1) 아래로 떨어지므로, 개수 글자는 불투명해야 한다. */
describe('chip count text', () => {
  it('label and region chip counts are rendered without opacity', async () => {
    await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    for (const groupName of ['라벨', '지역']) {
      const chips = within(screen.getByRole('group', { name: groupName })).getAllByRole('button');
      const counts = chips
        .flatMap((chip) => [...chip.querySelectorAll('span')])
        .filter((el) => el.childElementCount === 0 && /^\d+$/.test(el.textContent ?? ''));
      expect(counts.length, groupName).toBeGreaterThan(0);
      for (const count of counts) {
        const opacity = getComputedStyle(count).opacity;
        expect(
          opacity === '' || opacity === '1',
          `${groupName} ${count.textContent} opacity=${opacity}`,
        ).toBe(true);
      }
    }
  });
});
