import type { Tokens } from 'src/theme/tokens';
import { pastel } from 'src/theme/tokens/pastel';

/**
 * 공용 색 팔레트(`@sch0718/ui-svelte` 0.3.0 `tokens.css`의 `data-palette` 블록)에서 옮긴 테마 7종.
 * 랜드마크는 React라 패키지를 쓰지 못해 값을 옮겨 적는다. 바꿀 때는 원본과 함께 고친다.
 * 원본: sch0718-toolkit-web/packages/ui-svelte/src/lib/tokens.css, theme.ts `PALETTES`
 *
 * 7종은 공용 중립 바탕(--bg·--surface·--surface2, --t1~--t3, --line)에 강조색만 다르다.
 * 랜드마크에만 있는 값(라벨 8색, 입력칸 테두리, 오류 글자, 그림자)은 파스텔 테마 값을, 둥글기는 공용 값을 쓴다.
 * 라벨 색은 라벨 바탕 위 글자 대비만 따지므로 바탕이 바뀌어도 그대로 쓸 수 있다.
 */

const FONT =
  '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif';

/** 공용 범용 토큰의 라이트·다크 값(바탕·글자·선·오류). */
const neutral = {
  light: {
    bg: { base: '#F6F7F9', surface: '#FFFFFF', raised: '#FFFFFF' },
    text: { primary: '#111317', secondary: '#5B6069', muted: '#676D77' },
    border: '#E3E5E9',
  },
  dark: {
    bg: { base: '#0E0F11', surface: '#17181B', raised: '#1F2125' },
    text: { primary: '#F2F3F5', secondary: '#A4A8B0', muted: '#868B94' },
    border: '#2A2D33',
  },
} as const;

function build(mode: 'light' | 'dark', accent: string): Tokens {
  const base = pastel[mode];
  const n = neutral[mode];
  return {
    bg: { ...n.bg },
    text: { ...n.text },
    border: n.border,
    borderStrong: base.borderStrong,
    error: base.error,
    errorHover: base.errorHover,
    accent: {
      main: accent,
      contrast: mode === 'light' ? '#FFFFFF' : '#0E0F11',
      text: accent,
      gradient: accent,
    },
    label: base.label,
    radius: { sm: 8, md: 12, lg: 16, xl: 24 },
    shadow: base.shadow,
    font: { body: FONT, display: FONT },
  };
}

/** 공용 `--accent` 값(라이트 / 다크). */
const ACCENTS = {
  violet: ['#5B47E0', '#A093FF'],
  blue: ['#2F5BD3', '#8FB0FF'],
  teal: ['#1D5A73', '#7CC4DC'],
  forest: ['#1B7346', '#5FCF94'],
  rose: ['#B01E50', '#FF8AB0'],
  plum: ['#8C3AA6', '#D79CF0'],
  mono: ['#2B2F36', '#E4E6EA'],
} as const;

export type PaletteThemeName = keyof typeof ACCENTS;

export const PALETTE_THEMES = Object.fromEntries(
  Object.entries(ACCENTS).map(([name, [light, dark]]) => [
    name,
    { light: build('light', light), dark: build('dark', dark) },
  ]),
) as Record<PaletteThemeName, { light: Tokens; dark: Tokens }>;
