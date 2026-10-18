import { describe, expect, it } from 'vitest';
import { createAppTheme, cssVarsOf } from 'src/theme/create-app-theme';
import { TOKENS, type ColorMode, type ThemeName } from 'src/theme/tokens';

const THEMES = Object.keys(TOKENS) as ThemeName[];
const MODES: ColorMode[] = ['light', 'dark'];

describe('createAppTheme', () => {
  it.each(THEMES.flatMap((name) => MODES.map((mode) => [name, mode] as const)))(
    '%s/%s: Paper has no elevation overlay and text buttons use accent.text',
    (name, mode) => {
      const theme = createAppTheme(name, mode);
      const paper = theme.components?.MuiPaper?.styleOverrides?.root as Record<string, unknown>;
      expect(paper.backgroundImage).toBe('none');
      const button = theme.components?.MuiButton?.styleOverrides as {
        textPrimary: { color: string };
        outlinedPrimary: { color: string };
      };
      expect(button.textPrimary.color).toBe(TOKENS[name][mode].accent.text);
      expect(button.outlinedPrimary.color).toBe(TOKENS[name][mode].accent.text);
      expect(theme.palette.primary.main).toBe(TOKENS[name][mode].accent.main);
    },
  );

  it.each(THEMES.flatMap((name) => MODES.map((mode) => [name, mode] as const)))(
    '%s/%s: placeholder uses text.muted, selected tab uses accent.text, border-strong is a CSS var',
    (name, mode) => {
      const t = TOKENS[name][mode];
      const theme = createAppTheme(name, mode);
      const base = theme.components?.MuiCssBaseline?.styleOverrides as Record<string, unknown>;
      expect(base['::placeholder']).toEqual({ color: t.text.muted, opacity: 1 });
      const tab = theme.components?.MuiTab?.styleOverrides?.root as Record<string, unknown>;
      expect(tab['&.Mui-selected']).toEqual({ color: t.accent.text });
      expect(cssVarsOf(t)['--tm-border-strong']).toBe(t.borderStrong);
      expect(cssVarsOf(t)['--tm-border']).toBe(t.border);
    },
  );

  it.each(THEMES.flatMap((name) => MODES.map((mode) => [name, mode] as const)))(
    '%s/%s: 대화상자 제목은 굵기 800(크기는 정하지 않는다)',
    (name, mode) => {
      const title = createAppTheme(name, mode).components?.MuiDialogTitle?.styleOverrides?.root;
      expect(title).toEqual({ fontWeight: 800 });
    },
  );

  it.each(THEMES.flatMap((name) => MODES.map((mode) => [name, mode] as const)))(
    '%s/%s: TextField의 테두리는 강한 테두리색(대체값 포함)·둥근 모서리, 포커스는 accent.text',
    (name, mode) => {
      const t = TOKENS[name][mode];
      const root = createAppTheme(name, mode).components?.MuiOutlinedInput?.styleOverrides
        ?.root as Record<string, Record<string, unknown> | string>;
      const strong = 'var(--tm-border-strong, var(--tm-border))';
      expect(root.borderRadius).toBe('var(--tm-radius-md)');
      expect(root['& .MuiOutlinedInput-notchedOutline']).toEqual({ borderColor: strong });
      expect(
        root['&:not(.Mui-error):not(.Mui-disabled):hover .MuiOutlinedInput-notchedOutline'],
      ).toEqual({
        borderColor: strong,
      });
      expect(root['&.Mui-focused:not(.Mui-error) .MuiOutlinedInput-notchedOutline']).toEqual({
        borderColor: t.accent.text,
        borderWidth: 2,
      });
    },
  );
});

describe('오류 색', () => {
  it('MUI error.main과 --tm-error는 토큰의 error다', () => {
    for (const name of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) {
      for (const mode of ['light', 'dark'] as const) {
        const tokens = TOKENS[name][mode];
        expect(createAppTheme(name, mode).palette.error.main, `${name}/${mode}`).toBe(tokens.error);
        expect(cssVarsOf(tokens)['--tm-error'], `${name}/${mode}`).toBe(tokens.error);
      }
    }
  });
});

describe('빨간 채운 버튼', () => {
  /** `#RRGGBB`·`#fff`·`rgba(r, g, b, a)`를 [r, g, b, a]로. */
  function rgba(color: string): [number, number, number, number] {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(color);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    const hex = color.length === 4 ? color.replace(/[0-9a-f]/gi, (c) => c + c) : color;
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1) as [
      number,
      number,
      number,
      number,
    ];
  }
  const lum = ([r, g, b]: number[]) => {
    const ch = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(r!) + 0.7152 * ch(g!) + 0.0722 * ch(b!);
  };
  const ratio = (fg: string, bg: string) => {
    const [br, bg2, bb] = rgba(bg);
    const [fr, fg2, fb, a] = rgba(fg);
    const mixed = [fr * a + br * (1 - a), fg2 * a + bg2 * (1 - a), fb * a + bb * (1 - a)];
    const [hi, lo] = [lum(mixed), lum([br, bg2, bb])].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };

  it('글자가 평소(error.main)와 마우스를 올렸을 때(error.dark) 모두 4.5:1 이상', () => {
    for (const name of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) {
      for (const mode of ['light', 'dark'] as const) {
        const { main, dark, contrastText } = createAppTheme(name, mode).palette.error;
        expect(ratio(contrastText, main), `${name}/${mode} main`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(contrastText, dark), `${name}/${mode} hover`).toBeGreaterThanOrEqual(4.5);
        expect(dark, `${name}/${mode}`).toBe(TOKENS[name][mode].errorHover);
      }
    }
  });
});
