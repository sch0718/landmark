import { createTheme, type Theme } from '@mui/material/styles';
import { LABEL_COLORS } from 'src/schema/library';
import { TOKENS, type ColorMode, type ThemeName, type Tokens } from 'src/theme/tokens';

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

/**
 * 키보드 포커스 표시(스펙 §2). 모든 조작 요소가 같은 바깥선을 쓴다. 색은 바탕 위 대비가 나오는 강조색 글자색.
 * 마우스로 누를 때는 그리지 않도록 `:focus-visible`(MUI는 `.Mui-focusVisible`)에서만 쓴다.
 * `outline: 2px solid var(--tm-accent-text)`를 낱낱의 속성으로 쓴 것이다(값은 같다).
 */
const FOCUS_RING = {
  outlineWidth: 2,
  outlineStyle: 'solid',
  outlineColor: 'var(--tm-accent-text)',
  outlineOffset: 2,
} as const;

/** 넘침을 자르는 칸(탭 줄·메뉴) 안의 요소는 바깥선이 잘리지 않게 안쪽으로 그린다. */
const FOCUS_RING_INSET = { ...FOCUS_RING, outlineOffset: -2 } as const;

/** 토큰을 CSS 변수(`--tm-*`)로 펼친다. 컴포넌트는 `var(--tm-bg-surface)`처럼 읽는다. */
export function cssVarsOf(tokens: Tokens): Record<string, string> {
  const vars: Record<string, string> = {
    '--tm-bg-base': tokens.bg.base,
    '--tm-bg-surface': tokens.bg.surface,
    '--tm-bg-raised': tokens.bg.raised,
    '--tm-text-primary': tokens.text.primary,
    '--tm-text-secondary': tokens.text.secondary,
    '--tm-text-muted': tokens.text.muted,
    '--tm-border': tokens.border,
    '--tm-accent-main': tokens.accent.main,
    '--tm-accent-contrast': tokens.accent.contrast,
    '--tm-accent-text': tokens.accent.text,
    '--tm-accent-gradient': tokens.accent.gradient,
    '--tm-radius-sm': `${tokens.radius.sm}px`,
    '--tm-radius-md': `${tokens.radius.md}px`,
    '--tm-radius-lg': `${tokens.radius.lg}px`,
    '--tm-radius-xl': `${tokens.radius.xl}px`,
    '--tm-shadow-1': tokens.shadow[1],
    '--tm-shadow-2': tokens.shadow[2],
    '--tm-font-body': tokens.font.body,
    '--tm-font-display': tokens.font.display,
  };
  for (const color of LABEL_COLORS) {
    const { fill, text, marker } = tokens.label[color];
    vars[`--tm-label-${color}-fill`] = fill;
    vars[`--tm-label-${color}-text`] = text;
    vars[`--tm-label-${color}-marker`] = marker;
  }
  return vars;
}

/** 토큰에서 MUI 테마를 만든다. 터치 대상 44px·입력 16px(iOS 확대 방지)은 모든 테마에 공통이다. */
export function createAppTheme(name: ThemeName, mode: ColorMode): Theme {
  const t = TOKENS[name][mode];
  return createTheme({
    palette: {
      mode,
      primary: { main: t.accent.main, contrastText: t.accent.contrast },
      background: { default: t.bg.base, paper: t.bg.surface },
      text: { primary: t.text.primary, secondary: t.text.secondary, disabled: t.text.muted },
      divider: t.border,
    },
    shape: { borderRadius: t.radius.md },
    typography: {
      fontFamily: t.font.body,
      body1: { fontSize: 16 },
      body2: { fontSize: 14 },
      caption: { fontSize: 12 },
      ...Object.fromEntries(HEADINGS.map((h) => [h, { fontFamily: t.font.display }])),
    },
    components: {
      // 직접 만든 요소(`button`·`a`·`input` 등)의 포커스 표시. 자리마다 정한 `&:focus-visible`이 있으면 그쪽이 우선한다.
      MuiCssBaseline: { styleOverrides: { ':focus-visible': FOCUS_RING } },
      // MUI의 버튼·탭·칩·목록 행·체크 상자는 모두 `ButtonBase`라서 여기 하나로 같은 바깥선을 그린다.
      MuiButtonBase: { styleOverrides: { root: { '&.Mui-focusVisible': FOCUS_RING } } },
      MuiTab: { styleOverrides: { root: { '&.Mui-focusVisible': FOCUS_RING_INSET } } },
      MuiMenuItem: { styleOverrides: { root: { '&.Mui-focusVisible': FOCUS_RING_INSET } } },
      // MUI 다크 Paper는 높이에 따라 흰 오버레이(backgroundImage)를 덮어 불투명 표면 토큰을 흐린다.
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiButton: {
        defaultProps: { disableElevation: true },
        // 채운 버튼은 accent.main 바탕에 contrast 글자. 글자·아웃라인 버튼은 바탕 위 대비가 나오는 accent.text.
        styleOverrides: {
          textPrimary: { color: t.accent.text },
          outlinedPrimary: { color: t.accent.text, borderColor: t.accent.text },
        },
      },
      MuiLink: { styleOverrides: { root: { color: t.accent.text } } },
      MuiIconButton: {
        styleOverrides: { root: { minWidth: 44, minHeight: 44 } },
      },
      MuiInputBase: {
        styleOverrides: { input: { fontSize: 16 } },
      },
    },
  });
}
