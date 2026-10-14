import type { Theme } from '@mui/material/styles';
import type { SystemStyleObject } from '@mui/system';
import { FIELD_BORDER } from 'src/theme/field-border';

/** 입력칸과 검색칸 상자가 같이 쓰는 테두리·모서리·배경. */
const FIELD_BOX = {
  border: FIELD_BORDER,
  borderRadius: 'var(--tm-radius-md)',
  bgcolor: 'var(--tm-bg-raised)',
} as const;

type FieldOptions = {
  /** 잘못된 값이면 테두리를 `error` 색으로 */
  invalid?: boolean;
  /** 여러 줄 입력칸(`textarea`)이면 기본 높이를 96px로, 세로로만 늘어나게 */
  multiline?: boolean;
  /** 최소 높이(px). 안 주면 한 줄 44, 여러 줄 96 */
  minHeight?: number;
};

/**
 * 직접 만든 `input`·`textarea`의 한 가지 모양(스펙 §5).
 * 화면 배치용 값(`flex`·`minWidth` 등)은 `sx={[fieldSx(), { flex: 1 }]}`처럼 자리에서 덧붙인다.
 * 포커스 바깥선은 테마의 전역 `:focus-visible` 규칙이 그리므로 여기서 다시 정하지 않는다.
 * 안내 글자 색(`text.muted`)도 테마의 `::placeholder` 규칙이다.
 * 테두리 색의 대체값(`--tm-border`)은 `--tm-border-strong`이 없어도 지금 테두리로 그려지게 한다(스펙 §8).
 */
export function fieldSx({
  invalid = false,
  multiline = false,
  minHeight,
}: FieldOptions = {}): SystemStyleObject<Theme> {
  return {
    boxSizing: 'border-box',
    display: 'block',
    width: '100%',
    minHeight: minHeight ?? (multiline ? 96 : 44),
    px: 1.25,
    ...(multiline && { py: 1.25, lineHeight: 1.6, resize: 'vertical' }),
    ...FIELD_BOX,
    ...(invalid && { borderColor: 'error.main' }),
    color: 'var(--tm-text-primary)',
    font: 'inherit',
    fontSize: 16,
    '&:disabled': { opacity: 0.5 },
  };
}

/**
 * 테두리 상자 안에 돋보기와 `InputBase`를 넣은 검색칸의 감싸개.
 * `label`로 만들어(`component="label"`) 돋보기·여백을 눌러도 입력칸에 포커스가 가고,
 * 입력칸이 상자 높이를 채운다(`InputBase`에 `sx={SEARCH_INPUT_SX}`). 바깥선은 상자가 대신 그린다.
 */
export const SEARCH_BOX_SX = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 1,
  minHeight: 44,
  pl: 1.5,
  ...FIELD_BOX,
  color: 'var(--tm-text-muted)',
  cursor: 'text',
  '& > svg': { alignSelf: 'center', flex: 'none' },
  '&:focus-within': {
    borderColor: 'var(--tm-accent-text)',
    outline: '2px solid var(--tm-accent-text)',
    outlineOffset: 2,
  },
  // 상자가 바깥선을 그리므로 안쪽 입력칸의 전역 바깥선은 끈다.
  '& input:focus-visible': { outline: 'none' },
} as const;

/** `SEARCH_BOX_SX` 안의 `InputBase`. 상자 높이를 채우고 오른쪽 여백을 안쪽에 둔다. */
export const SEARCH_INPUT_SX = {
  alignSelf: 'stretch',
  alignItems: 'stretch',
  pr: 1.5,
  color: 'var(--tm-text-primary)',
  // MUI의 고정 높이(1.4375em)를 풀어 입력칸이 상자 높이를 채우게 한다.
  '& .MuiInputBase-input': { height: 'auto' },
} as const;
