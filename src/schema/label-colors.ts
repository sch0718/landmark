/**
 * 라벨 색 목록. 의존성이 없는 파일이라 보기 화면·지도 페이지처럼 Effect를 번들에 넣지 않아야 하는
 * 곳도 이 파일을 직접 import한다. `src/schema/library.ts`는 여기서 다시 export한다.
 */
export const LABEL_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
] as const;

export type LabelColorName = (typeof LABEL_COLORS)[number];
