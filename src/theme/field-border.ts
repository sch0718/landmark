/**
 * 입력칸 테두리 색. `--tm-border-strong`이 없어도 지금 테두리(`--tm-border`)로 그려지게 대체값을 둔다(스펙 §8).
 * 직접 만든 입력칸(`fieldSx`)·검색칸 상자·MUI `OutlinedInput` 재정의가 같이 쓴다.
 */
export const FIELD_BORDER_COLOR = 'var(--tm-border-strong, var(--tm-border))';
export const FIELD_BORDER = `1px solid ${FIELD_BORDER_COLOR}`;
