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
});
