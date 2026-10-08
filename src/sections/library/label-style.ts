import type { LabelColor } from 'src/schema/library';

/** 라벨 색의 테마 토큰(`--tm-label-<색>-*`). 색 값은 테마가 정한다. */
export const labelColors = (color: LabelColor) => ({
  fill: `var(--tm-label-${color}-fill)`,
  text: `var(--tm-label-${color}-text)`,
  marker: `var(--tm-label-${color}-marker)`,
});
