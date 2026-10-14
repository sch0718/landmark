import TextField from '@mui/material/TextField';
import { ThemeProvider } from '@mui/material/styles';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppTheme } from 'src/theme/create-app-theme';
import { TOKENS } from 'src/theme/tokens';

afterEach(cleanup);

type State = 'resting' | 'hover' | 'focused';

/** CSS 색 문자열을 브라우저(jsdom)가 쓰는 꼴로 맞춘다(`#d32f2f` -> `rgb(...)`). */
const normalize = (value: string) => {
  const probe = document.createElement('div');
  probe.style.borderColor = value;
  return probe.style.borderColor;
};

/** 선택자의 우선순위(클래스·가상 클래스 수). `:not(X)`는 X만큼 센다. 이 테스트의 선택자에는 id·태그가 없다. */
const specificity = (selector: string) => (selector.match(/[.:](?!not\()[\w-]+/g) ?? []).length;

/**
 * 윤곽선(`notchedOutline`)의 테두리 색이 `state`에서 무엇으로 정해지는지 방출된 규칙을 읽어 따져 본다
 * (jsdom의 계산 스타일은 가상 클래스를 못 풀어서 우선순위·순서를 직접 적용한다).
 * 대상은 오류 여부(`error`)와 상태만 다른 `OutlinedInput` 뿌리 하나다.
 */
function outlineColor(state: State, error: boolean): string | undefined {
  const rules = [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
  let winner: { score: number; color: string } | undefined;
  for (const rule of rules) {
    const color = rule.style.getPropertyValue('border-color');
    // 뿌리 클래스(`.css-…-MuiOutlinedInput-root`) 뒤에 윤곽선이 오는 규칙만.
    const match = /^\.css-[\w-]+-MuiOutlinedInput-root(.*) \.MuiOutlinedInput-notchedOutline$/.exec(
      rule.selectorText,
    );
    if (match === null || color === '') continue;
    const conditions = match[1]!;
    const notError = conditions.includes(':not(.Mui-error)');
    const needsError = conditions.replace(':not(.Mui-error)', '').includes('.Mui-error');
    const applies =
      (!conditions.includes(':hover') || state === 'hover') &&
      (!conditions.includes('.Mui-focused') || state === 'focused') &&
      !conditions.includes('.Mui-disabled') &&
      (!needsError || error) &&
      (!notError || !error);
    if (!applies) continue;
    const score = specificity(rule.selectorText);
    if (winner === undefined || score >= winner.score) winner = { score, color };
  }
  return winner?.color;
}

describe('TextField 윤곽선 색', () => {
  const theme = createAppTheme('night', 'dark');
  const t = TOKENS.night.dark;
  const renderField = (error: boolean) =>
    render(
      <ThemeProvider theme={theme}>
        <TextField label="제목" error={error} />
      </ThemeProvider>,
    );

  it.each(['resting', 'hover', 'focused'] as const)(
    '잘못된 값이면 %s에서도 오류 색이다',
    (state) => {
      renderField(true);
      expect(outlineColor(state, true)).toBe(normalize(theme.palette.error.main));
    },
  );

  it('정상 값은 가만히·호버에서 강한 테두리색, 포커스에서 accent.text', () => {
    renderField(false);
    const strong = 'var(--tm-border-strong, var(--tm-border))';
    expect(outlineColor('resting', false)).toBe(strong);
    expect(outlineColor('hover', false)).toBe(strong);
    expect(outlineColor('focused', false)).toBe(normalize(t.accent.text));
  });
});
