import type { LabelColor } from 'src/schema/library';
import { night } from 'src/theme/tokens/night';
import { paper } from 'src/theme/tokens/paper';
import { pastel } from 'src/theme/tokens/pastel';

export type ThemeName = 'pastel' | 'paper' | 'night';
export type ColorMode = 'light' | 'dark';

export type Tokens = {
  bg: { base: string; surface: string; raised: string };
  text: { primary: string; secondary: string; muted: string };
  border: string;
  /** 입력칸·체크 상자 테두리. `bg.raised` 위에서 3:1 이상. 목록 구분선 등은 `border`. */
  borderStrong: string;
  /**
   * 늦음·오류 글자 색(MUI `error.main`, `--tm-error`). `bg.surface`·`bg.raised` 위에서 4.5:1 이상.
   * MUI 기본 다크 값(#f44336)은 어두운 바탕에서 대비가 모자라 테마마다 둔다.
   */
  error: string;
  /**
   * 빨간 채운 버튼에 마우스를 올렸을 때의 바탕(MUI `error.dark`). 그 버튼 글자(`error.contrastText`)가 4.5:1 이상.
   * 라이트는 MUI가 만들던 값 그대로, 다크는 MUI 자동값(#B2554E)이 검정 글자와 3.95라 따로 둔다.
   */
  errorHover: string;
  accent: {
    main: string;
    /** `main` 위에 올리는 글자·아이콘 색. */
    contrast: string;
    /** 바탕 위의 글자·텍스트/아웃라인 버튼·링크 색. `main`은 채운 버튼 바탕이라 어두운 바탕에서는 글자로 대비가 모자라다. */
    text: string;
    /** `background` 값. 단색 테마는 `main`과 같고, 나이트는 보라→하늘 그라데이션이다. */
    gradient: string;
  };
  label: Record<LabelColor, { fill: string; text: string; marker: string }>;
  /** px. */
  radius: { sm: number; md: number; lg: number; xl: number };
  shadow: { 1: string; 2: string };
  font: { body: string; display: string };
};

export const TOKENS: Record<ThemeName, { light: Tokens; dark: Tokens }> = {
  pastel,
  paper,
  night,
};
