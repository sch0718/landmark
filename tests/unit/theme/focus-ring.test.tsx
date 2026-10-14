import Button from '@mui/material/Button';
import CssBaseline from '@mui/material/CssBaseline';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { ThemeProvider } from '@mui/material/styles';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppTheme } from 'src/theme/create-app-theme';

afterEach(() => {
  cleanup();
});

function renderWithTheme(children: ReactNode) {
  render(
    <ThemeProvider theme={createAppTheme('pastel', 'light')}>
      <CssBaseline />
      {children}
    </ThemeProvider>,
  );
  return screen.getByRole('button');
}

describe('포커스 표시', () => {
  it('키보드로 포커스한 MUI 버튼은 강조색 글자색 바깥선을 그린다', async () => {
    const user = userEvent.setup();
    const mui = renderWithTheme(<Button>저장</Button>);
    await user.tab();
    expect(mui).toHaveFocus();
    expect(mui).toHaveClass('Mui-focusVisible');
    const style = getComputedStyle(mui);
    expect(style.outlineStyle).toBe('solid');
    expect(style.outlineWidth).toBe('2px');
    expect(style.outlineColor).toBe('var(--tm-accent-text)');
    expect(style.outlineOffset).toBe('2px');
  });

  it('마우스로 누른 MUI 버튼에는 바깥선이 없다', async () => {
    const user = userEvent.setup();
    const mui = renderWithTheme(<Button>저장</Button>);
    await user.click(mui);
    expect(mui).toHaveFocus();
    expect(mui).not.toHaveClass('Mui-focusVisible');
    expect(getComputedStyle(mui).outlineStyle).not.toBe('solid');
  });

  it('넘침을 자르는 탭 줄 안의 탭은 같은 바깥선을 안쪽으로 그린다', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider theme={createAppTheme('pastel', 'light')}>
        <Tabs value={0} aria-label="날짜">
          <Tab label="Day 1" />
        </Tabs>
      </ThemeProvider>,
    );
    const tab = screen.getByRole('tab', { name: 'Day 1' });
    await user.tab();
    expect(tab).toHaveClass('Mui-focusVisible');
    const style = getComputedStyle(tab);
    expect(style.outlineStyle).toBe('solid');
    expect(style.outlineColor).toBe('var(--tm-accent-text)');
    expect(style.outlineOffset).toBe('-2px');
  });

  it('직접 만든 요소에는 전역 :focus-visible 규칙으로 같은 바깥선을 그린다', () => {
    renderWithTheme(<button type="button">직접 만든 버튼</button>);
    // jsdom의 `:focus-visible` 판정은 이벤트 순서에 따라 달라 믿기 어렵다. 전역 규칙 자체를 확인한다.
    const rules = [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
      .filter((rule) => rule.selectorText === ':focus-visible');
    expect(rules).toHaveLength(1);
    const { style } = rules[0]!;
    expect(style.outlineStyle).toBe('solid');
    expect(style.outlineWidth).toBe('2px');
    expect(style.outlineColor).toBe('var(--tm-accent-text)');
    expect(style.outlineOffset).toBe('2px');
  });
});
