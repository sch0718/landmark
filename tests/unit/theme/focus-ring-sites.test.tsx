import { ThemeProvider } from '@mui/material/styles';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { ChipButton } from 'src/sections/library/ChipButton';
import { DragHandle } from 'src/sections/trips/planner/PlannerDnd';
import { createAppTheme } from 'src/theme/create-app-theme';
import { renderLibrary, sampleLibrary } from '../sections/library/fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

/** 요소의 클래스에 걸린 `:focus-visible` 규칙들(`suffix`는 `> span`처럼 그 뒤에 붙는 선택자). */
function focusRules(element: Element, suffix = ''): CSSStyleDeclaration[] {
  const classes = [...element.classList].map((name) => `.${name}`);
  return [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
    .filter(({ selectorText }) =>
      selectorText
        .split(',')
        .map((part) => part.replace(/\s+/g, ''))
        .some((part) =>
          classes.some((name) => part === `${name}:focus-visible${suffix.replace(/\s+/g, '')}`),
        ),
    )
    .map((rule) => rule.style);
}

/** 바깥선의 색·모양을 자리에서 다시 정하지 않았다(테마의 전역 규칙을 쓴다). 위치만 바꿀 수 있다. */
function expectThemeRing(element: Element, offset: string | null) {
  const rules = focusRules(element);
  for (const style of rules) {
    expect(style.getPropertyValue('outline')).toBe('');
    expect(style.outlineColor).toBe('');
    expect(style.outlineStyle).toBe('');
    expect(style.outlineWidth).toBe('');
  }
  const offsets = rules.map((style) => style.outlineOffset).filter((value) => value !== '');
  expect(offsets).toEqual(offset === null ? [] : [offset]);
}

describe('자리마다의 포커스 표시가 테마의 바깥선을 쓴다', () => {
  it('목록 행: 스크롤 목록 안이라 안쪽으로만 옮긴다', async () => {
    await renderLibrary(sampleLibrary(), { prefs: { libraryView: 'list' } });
    const list = screen.getByRole('list', { name: '장소 목록' });
    const row = within(within(list).getAllByRole('listitem')[0]!).getAllByRole('button')[0]!;
    expectThemeRing(row, '-2px');
  });

  it('설정 타일(테마 고르기): 자리의 규칙이 없다', async () => {
    await renderLibrary(sampleLibrary(), { path: '/settings' });
    const tiles = await screen.findAllByRole('radio');
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) expectThemeRing(tile, null);
  });

  it('여행 계획 끌기 손잡이: 안쪽으로만 옮긴다', () => {
    render(
      <ThemeProvider theme={createAppTheme('night', 'dark')}>
        <DragHandle
          name="중앙시장"
          setActivatorNodeRef={() => undefined}
          attributes={{}}
          listeners={undefined}
        />
      </ThemeProvider>,
    );
    expectThemeRing(screen.getByRole('button', { name: '중앙시장 끌어 옮기기' }), '-2px');
  });

  it('칩: 누르는 자리 대신 보이는 알약에 테마와 같은 바깥선을 그린다', () => {
    render(
      <ThemeProvider theme={createAppTheme('night', 'dark')}>
        <ChipButton selected={false} onClick={() => undefined}>
          맛집
        </ChipButton>
      </ThemeProvider>,
    );
    const chip = screen.getByRole('button', { name: '맛집' });
    const [own] = focusRules(chip);
    expect(own?.getPropertyValue('outline-style') || own?.getPropertyValue('outline')).toMatch(
      /none/,
    );
    const [pill] = focusRules(chip, ' > span');
    expect(pill?.outlineStyle).toBe('solid');
    expect(pill?.outlineWidth).toBe('2px');
    expect(pill?.outlineColor).toBe('var(--tm-accent-text)');
    expect(pill?.outlineOffset).toBe('2px');
  });
});
