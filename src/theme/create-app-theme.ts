import { createTheme, type Theme } from '@mui/material/styles';
import { LABEL_COLORS } from 'src/schema/library';
import { TOKENS, type ColorMode, type ThemeName, type Tokens } from 'src/theme/tokens';

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

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
