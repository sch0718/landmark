import { describe, expect, it } from 'vitest';
import { LABEL_COLORS } from 'src/schema/library';
import { contrastRatio } from 'src/theme/contrast';
import { TOKENS, type ColorMode, type ThemeName } from 'src/theme/tokens';

const THEMES = Object.keys(TOKENS) as ThemeName[];
const MODES: ColorMode[] = ['light', 'dark'];
const all = THEMES.flatMap((name) =>
  MODES.map((mode) => ({ name, mode, tokens: TOKENS[name][mode] })),
);

describe('contrastRatio', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    // 짧은 hex·rgb()도 같은 값
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrastRatio('rgb(0, 0, 0)', 'rgb(255 255 255)')).toBeCloseTo(21, 5);
    // #767676 on white = 4.54 (AA 경계로 잘 알려진 값)
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });

  it('composites a translucent foreground over the background', () => {
    // 검정 50%를 흰 바탕에 얹으면 #808080
    expect(contrastRatio('rgba(0,0,0,0.5)', '#FFFFFF')).toBeCloseTo(
      contrastRatio('#808080', '#FFFFFF'),
      1,
    );
    expect(contrastRatio('#00000080', '#FFFFFF')).toBeCloseTo(
      contrastRatio('rgba(0,0,0,0.5)', '#FFFFFF'),
      1,
    );
  });

  it('rejects colors it cannot read', () => {
    expect(() => contrastRatio('red', '#fff')).toThrow();
  });
});

describe('theme contrast (6 themes)', () => {
  it('meets AA for text, accent, label and input-border pairs', () => {
    const failures: string[] = [];
    const check = (where: string, fg: string, bg: string, min: number) => {
      const ratio = contrastRatio(fg, bg);
      if (ratio < min) failures.push(`${where} ${fg} on ${bg} = ${ratio.toFixed(2)} (< ${min})`);
    };
    for (const { name, mode, tokens } of all) {
      const at = `${name}/${mode}`;
      for (const [bgName, bg] of Object.entries(tokens.bg)) {
        check(`${at} text.secondary/bg.${bgName}`, tokens.text.secondary, bg, 4.5);
        check(`${at} text.muted/bg.${bgName}`, tokens.text.muted, bg, 4.5);
        check(`${at} accent.text/bg.${bgName}`, tokens.accent.text, bg, 4.5);
      }
      // 채운 버튼: accent.main 바탕의 accent.contrast 글자
      check(`${at} accent.contrast/accent.main`, tokens.accent.contrast, tokens.accent.main, 4.5);
      // 입력칸 테두리(입력칸 바탕은 bg.raised)
      check(`${at} border.strong/bg.raised`, tokens.borderStrong, tokens.bg.raised, 3);
      for (const color of LABEL_COLORS) {
        // 칩·타일의 이름·개수 글자는 모두 라벨 글자색을 라벨 바탕 위에 반투명 없이 쓴다(개수 글자에 opacity가 없다는 것은 chip-counts.test.tsx가 확인)
        check(`${at} label.${color}`, tokens.label[color].text, tokens.label[color].fill, 4.5);
      }
      // 라벨 없는 타일('미분류'): bg.raised 위 text.secondary
      check(`${at} tile/unlabeled`, tokens.text.secondary, tokens.bg.raised, 4.5);
    }
    expect(failures).toEqual([]);
  });
});
