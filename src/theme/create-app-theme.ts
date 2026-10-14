import { createTheme, type Theme } from '@mui/material/styles';
import { LABEL_COLORS } from 'src/schema/library';
import { FIELD_BORDER_COLOR } from 'src/theme/field-border';
import { FOCUS_RING, FOCUS_RING_INSET } from 'src/theme/focus-ring';
import { TOKENS, type ColorMode, type ThemeName, type Tokens } from 'src/theme/tokens';

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

/** 입력칸 안내 글자의 가상 요소(브라우저마다 이름이 다르다). */
const PLACEHOLDER_PSEUDOS = [
  '::placeholder',
  '::-webkit-input-placeholder',
  '::-moz-placeholder',
] as const;

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
    '--tm-border-strong': tokens.borderStrong,
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
      // 입력칸 안내 글자는 보조 글자 중 가장 옅은 text.muted. 파이어폭스는 안내 글자에 기본 투명도를 얹으므로 1로 되돌린다.
      MuiCssBaseline: {
        styleOverrides: {
          ':focus-visible': FOCUS_RING,
          '::placeholder': { color: t.text.muted, opacity: 1 },
        },
      },
      // MUI의 버튼·탭·칩·목록 행·체크 상자는 모두 `ButtonBase`라서 여기 하나로 같은 바깥선을 그린다.
      MuiButtonBase: { styleOverrides: { root: { '&.Mui-focusVisible': FOCUS_RING } } },
      // 고른 탭 글자는 바탕 위 대비가 나오는 accent.text(accent.main은 어두운 바탕에서 글자로 모자란다). 밑줄은 main 그대로.
      MuiTab: {
        styleOverrides: {
          root: {
            '&.Mui-selected': { color: t.accent.text },
            '&.Mui-focusVisible': FOCUS_RING_INSET,
          },
        },
      },
      MuiMenuItem: { styleOverrides: { root: { '&.Mui-focusVisible': FOCUS_RING_INSET } } },
      // MUI 다크 Paper는 높이에 따라 흰 오버레이(backgroundImage)를 덮어 불투명 표면 토큰을 흐린다.
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      // 스위치는 뿌리가 넘침을 잘라(`overflow: hidden`) 바깥쪽 바깥선이 보이지 않는다. 눌리는 동그라미(`switchBase`)에 안쪽으로 그린다.
      MuiSwitch: {
        styleOverrides: { switchBase: { '&.Mui-focusVisible': FOCUS_RING_INSET } },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        // 채운 버튼은 accent.main 바탕에 contrast 글자. 글자·아웃라인 버튼은 바탕 위 대비가 나오는 accent.text.
        styleOverrides: {
          textPrimary: { color: t.accent.text },
          outlinedPrimary: { color: t.accent.text, borderColor: t.accent.text },
        },
      },
      MuiLink: { styleOverrides: { root: { color: t.accent.text } } },
      // 대화상자 제목은 다른 화면 제목처럼 800(MUI 기본은 500). 크기는 그대로다.
      MuiDialogTitle: { styleOverrides: { root: { fontWeight: 800 } } },
      MuiIconButton: {
        styleOverrides: { root: { minWidth: 44, minHeight: 44 } },
      },
      // MUI는 안쪽 `input`에 `::-webkit-input-placeholder`로 `color: currentColor; opacity: 0.42`(다크 0.5)를 깔아
      // 전역 `::placeholder` 규칙보다 앞선다. 같은 선택자로 뒤에서 text.muted·투명도 1로 덮는다
      // (가상 요소 선택자는 묶으면 하나만 몰라도 규칙 전체가 버려지므로 낱낱의 키로 쓴다).
      // `TextField`의 이름표가 접히지 않은 동안 안내 글자를 숨기는 규칙(`opacity: 0 !important`)은 그대로 이기고,
      // 포커스하면 안내 글자를 0.5로 되살리는 MUI 규칙만 1로 맞춘다.
      MuiInputBase: {
        styleOverrides: {
          input: {
            fontSize: 16,
            ...Object.fromEntries(
              PLACEHOLDER_PSEUDOS.map((pseudo) => [
                `&${pseudo}`,
                { color: t.text.muted, opacity: 1 },
              ]),
            ),
            ...Object.fromEntries(
              PLACEHOLDER_PSEUDOS.map((pseudo) => [
                `label[data-shrink=false] + .MuiInputBase-formControl &:focus${pseudo}`,
                { opacity: 1 },
              ]),
            ),
          },
        },
      },
      // `TextField`의 입력칸. 직접 만든 입력칸(`fieldSx`)과 같은 테두리 색·모서리를 쓰고, 높이는 떠 있는 이름표 방식 그대로(56px)다.
      // 포커스는 테두리를 바깥선과 같은 강조색 글자색 2px로 그린다(안쪽 `input`의 전역 바깥선은 끈다).
      // 호버·포커스 규칙은 MUI의 `.Mui-error` 규칙과 우선순위가 같고 뒤에 오므로 `:not(.Mui-error)`로 오류 칸을 빼
      // 잘못된 값이면 가만히 있을 때도, 호버·포커스에서도 오류 색이 이긴다. 호버 규칙은 `:not(.Mui-disabled)`로 비활성 칸도 빼
      // 호버해도 비활성 테두리색이 그대로다.
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 'var(--tm-radius-md)',
            '& .MuiOutlinedInput-notchedOutline': { borderColor: FIELD_BORDER_COLOR },
            '&:not(.Mui-error):not(.Mui-disabled):hover .MuiOutlinedInput-notchedOutline': {
              borderColor: FIELD_BORDER_COLOR,
            },
            '&.Mui-focused:not(.Mui-error) .MuiOutlinedInput-notchedOutline': {
              borderColor: t.accent.text,
              borderWidth: 2,
            },
            '& input:focus-visible, & textarea:focus-visible': { outline: 'none' },
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: { '&.Mui-focused:not(.Mui-error)': { color: t.accent.text } },
        },
      },
    },
  });
}
