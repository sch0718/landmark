import Box from '@mui/material/Box';
import type { ReactNode } from 'react';
import { FOCUS_RING } from 'src/theme/focus-ring';

type Props = {
  selected: boolean;
  onClick(): void;
  disabled?: boolean;
  /** 선택됐을 때의 색. 없으면 포인트색. */
  tone?: { fill: string; text: string; marker: string };
  children: ReactNode;
};

/**
 * 필터 칩 하나. 눌림 영역은 44px 높이를 지키고, 눈에 보이는 알약은 그 안에서 더 작게 그린다.
 * 토글이라 `aria-pressed`로 상태를 알린다.
 */
export function ChipButton({ selected, onClick, disabled = false, tone, children }: Props) {
  return (
    <Box
      component="button"
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      sx={{
        flex: 'none',
        minHeight: 44,
        px: 0.25,
        border: 0,
        background: 'transparent',
        font: 'inherit',
        cursor: 'pointer',
        '&:disabled': { cursor: 'default', opacity: 0.45 },
        // 누르는 자리(44px)가 아니라 보이는 칩에 포커스 표시를 그린다.
        '&:focus-visible': { outline: 'none' },
        '&:focus-visible > span': FOCUS_RING,
      }}
    >
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          height: 32,
          px: 1.5,
          boxSizing: 'border-box',
          borderRadius: 999,
          border: '1px solid',
          fontSize: 14,
          fontWeight: 700,
          whiteSpace: 'nowrap',
          ...(selected
            ? {
                bgcolor: tone?.fill ?? 'var(--tm-accent-main)',
                color: tone?.text ?? 'var(--tm-accent-contrast)',
                borderColor: tone?.marker ?? 'var(--tm-accent-main)',
              }
            : {
                bgcolor: 'var(--tm-bg-surface)',
                color: 'var(--tm-text-secondary)',
                borderColor: 'var(--tm-border)',
              }),
          '& svg': { flex: 'none' },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
