import InputBase from '@mui/material/InputBase';
import TextField from '@mui/material/TextField';
import { ThemeProvider } from '@mui/material/styles';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppTheme } from 'src/theme/create-app-theme';
import { TOKENS } from 'src/theme/tokens';

afterEach(cleanup);

const PLACEHOLDER_PSEUDOS = ['::placeholder', '::-webkit-input-placeholder', '::-moz-placeholder'];

/**
 * 안쪽 `input`의 클래스에 걸린 안내 글자 규칙에서 `property`의 마지막 값(실제로 이기는 값)을 읽는다.
 * MUI InputBase가 `color: currentColor; opacity: 0.42`를 같은 가상 요소로 깔기 때문에, 전역 `::placeholder`
 * 규칙만으로는 이기지 못한다(그래서 테마의 `MuiInputBase` 규칙이 같은 선택자로 뒤에서 덮는다).
 */
function placeholderValue(
  input: Element,
  pseudo: string,
  property: string,
  /** 이름표가 접히지 않은 `TextField`의 규칙(`label[data-shrink=false] + …`)이면 `hide`/`focus`, 일반 규칙이면 생략 */
  variant?: 'hide' | 'focus',
): string | undefined {
  const classes = [...input.classList].map((name) => `.${name}`);
  let value: string | undefined;
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const selector = rule.selectorText;
      if (
        !classes.some(
          (cls) =>
            selector.endsWith(`${cls}${pseudo}`) || selector.endsWith(`${cls}:focus${pseudo}`),
        )
      ) {
        continue;
      }
      const inLabelRule = selector.startsWith('label[data-shrink=false]');
      const isFocus = selector.includes(`:focus${pseudo}`);
      const kind = !inLabelRule ? undefined : isFocus ? 'focus' : 'hide';
      if (kind !== variant) continue;
      const found = rule.style.getPropertyValue(property);
      if (found !== '')
        value =
          found + (rule.style.getPropertyPriority(property) === 'important' ? ' !important' : '');
    }
  }
  return value;
}

describe('MUI 입력칸 안내 글자', () => {
  it.each([
    ['night', 'dark'],
    ['paper', 'light'],
  ] as const)('%s/%s: InputBase·TextField 안내 글자는 text.muted, 투명도 1', (name, mode) => {
    const theme = createAppTheme(name, mode);
    const muted = TOKENS[name][mode].text.muted;
    const { container } = render(
      <ThemeProvider theme={theme}>
        <InputBase placeholder="검색" inputProps={{ 'aria-label': '검색' }} />
        <TextField label="제목" placeholder="입력" />
      </ThemeProvider>,
    );
    const inputs = container.querySelectorAll('.MuiInputBase-input');
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      for (const pseudo of PLACEHOLDER_PSEUDOS) {
        const color = placeholderValue(input, pseudo, 'color');
        // jsdom이 색을 `rgb(...)`로 풀어 줄 수 있어 같은 방식으로 바꿔 견준다.
        const probe = document.createElement('div');
        probe.style.color = muted;
        expect(color, pseudo).toBe(probe.style.color);
        expect(placeholderValue(input, pseudo, 'opacity'), pseudo).toBe('1');
      }
    }
  });

  it('이름표가 접히지 않은 TextField는 안내 글자를 숨기는 규칙이 그대로 이기고, 포커스하면 투명도 1이다', () => {
    const { container } = render(
      <ThemeProvider theme={createAppTheme('night', 'dark')}>
        <TextField label="제목" placeholder="입력" />
      </ThemeProvider>,
    );
    const input = container.querySelector('.MuiInputBase-input')!;
    // MUI가 쓰는 가상 요소(`::-webkit-input-placeholder`·`::-moz-placeholder`)에서 확인한다.
    for (const pseudo of PLACEHOLDER_PSEUDOS.slice(1)) {
      expect(placeholderValue(input, pseudo, 'opacity', 'hide'), pseudo).toBe('0 !important');
      expect(placeholderValue(input, pseudo, 'opacity', 'focus'), pseudo).toBe('1');
    }
  });
});
