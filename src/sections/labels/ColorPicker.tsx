import Box from '@mui/material/Box';
import { CheckIcon } from 'src/components/icons';
import { LABEL_COLORS, type LabelColor } from 'src/schema/library';
import { labelColors } from 'src/sections/library/label-style';

export const COLOR_NAMES: Record<LabelColor, string> = {
  red: '빨강',
  orange: '주황',
  yellow: '노랑',
  green: '초록',
  teal: '청록',
  blue: '파랑',
  purple: '보라',
  pink: '분홍',
};

type Props = { value: LabelColor; onChange(color: LabelColor): void };

/** 라벨 색 8개. 하나만 고르는 라디오 묶음이다. 눌림 영역은 44px, 눈에 보이는 원은 28px. */
export function ColorPicker({ value, onChange }: Props) {
  return (
    <Box role="radiogroup" aria-label="색" sx={{ display: 'flex', flexWrap: 'wrap' }}>
      {LABEL_COLORS.map((color) => {
        const checked = color === value;
        return (
          <Box
            key={color}
            component="button"
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={COLOR_NAMES[color]}
            onClick={() => onChange(color)}
            sx={{
              width: 44,
              height: 44,
              p: 0,
              border: 0,
              background: 'transparent',
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center',
              '&:focus-visible > span': {
                outline: '2px solid var(--tm-accent-main)',
                outlineOffset: 2,
              },
            }}
          >
            <Box
              component="span"
              sx={{
                display: 'grid',
                placeItems: 'center',
                width: 28,
                height: 28,
                borderRadius: '50%',
                bgcolor: labelColors(color).marker,
                color: 'var(--tm-bg-surface)',
                boxShadow: checked
                  ? '0 0 0 2px var(--tm-bg-surface), 0 0 0 4px currentColor'
                  : 'none',
                '& svg': { width: 16, height: 16 },
              }}
            >
              {checked && <CheckIcon aria-hidden="true" />}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
