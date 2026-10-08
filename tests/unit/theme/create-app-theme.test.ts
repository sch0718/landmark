import { describe, expect, it } from 'vitest';
import { createAppTheme } from 'src/theme/create-app-theme';
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
});
