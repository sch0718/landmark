import { describe, expect, it } from 'vitest';
import { LABEL_COLORS } from 'src/schema/library';
import { TOKENS, type ColorMode, type ThemeName, type Tokens } from 'src/theme/tokens';

const THEMES = Object.keys(TOKENS) as ThemeName[];
const MODES: ColorMode[] = ['light', 'dark'];
const all = THEMES.flatMap((name) =>
  MODES.map((mode) => ({ name, mode, tokens: TOKENS[name][mode] })),
);

/** 객체 안의 모든 잎 값의 경로(`a.b.c`)를 정렬해서 돌려준다. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value)
    .flatMap(([key, child]) => keyPaths(child, prefix === '' ? key : `${prefix}.${key}`))
    .sort();
}

function channel(hex: string, from: number): number {
  const c = parseInt(hex.slice(from, from + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x 상대 휘도. `#RRGGBB`만 받는다. */
function luminance(hex: string): number {
  expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/);
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('design tokens', () => {
  it('every theme and mode defines all token keys', () => {
    const expected = keyPaths(TOKENS.pastel.light);
    expect(expected).toContain('label.red.marker');
    for (const { name, mode, tokens } of all) {
      expect(keyPaths(tokens), `${name}/${mode}`).toEqual(expected);
    }
  });

  it('label palette has 8 colors in each theme/mode', () => {
    for (const { name, mode, tokens } of all) {
      expect(Object.keys(tokens.label), `${name}/${mode}`).toEqual([...LABEL_COLORS]);
    }
    expect(LABEL_COLORS).toHaveLength(8);
  });

  it('no Naver/Google accent', () => {
    const banned = ['#03a65a', '#1a73e8', '#4285f4'];
    for (const { name, mode, tokens } of all) {
      expect(banned, `${name}/${mode}`).not.toContain(tokens.accent.main.toLowerCase());
    }
  });

  it('text.primary on bg.base contrast >= 4.5', () => {
    for (const { name, mode, tokens } of all) {
      expect(
        contrast(tokens.text.primary, tokens.bg.base),
        `${name}/${mode}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('secondary text, accent contrast and label text stay readable', () => {
    const failures: string[] = [];
    const check = (where: string, fg: string, bg: string) => {
      const ratio = contrast(fg, bg);
      if (ratio < 4.5) failures.push(`${where} ${fg} on ${bg} = ${ratio.toFixed(2)}`);
    };
    for (const { name, mode, tokens } of all) {
      const at = `${name}/${mode}`;
      for (const bg of [tokens.bg.base, tokens.bg.surface, tokens.bg.raised]) {
        check(`${at} text.primary`, tokens.text.primary, bg);
        check(`${at} text.secondary`, tokens.text.secondary, bg);
      }
      check(`${at} accent`, tokens.accent.contrast, tokens.accent.main);
      for (const color of LABEL_COLORS) {
        check(`${at} label.${color}`, tokens.label[color].text, tokens.label[color].fill);
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps the brainstorm anchor values', () => {
    const pick = (t: Tokens) => [t.bg.base, t.text.primary, t.accent.main, t.accent.contrast];
    expect(pick(TOKENS.pastel.light)).toEqual(['#FAFAF7', '#18181B', '#18181B', '#D9F99D']);
    expect(TOKENS.paper.light.bg.base).toBe('#F6F1E7');
    expect(TOKENS.paper.light.text.primary).toBe('#2B2620');
    expect(TOKENS.paper.light.accent.main).toBe('#C2492D');
    expect(TOKENS.night.dark.bg.base).toBe('#0E1324');
    expect(TOKENS.night.dark.text.primary).toBe('#E8ECF8');
    expect(TOKENS.night.dark.accent.gradient).toMatch(/^linear-gradient\(.*#7C5CFF/);
  });
});
