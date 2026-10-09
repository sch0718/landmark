import Box from '@mui/material/Box';
import { LABEL_COLORS } from 'src/schema/library';
import { TOKENS, type ThemeName } from 'src/theme/tokens';
import { useResolvedTheme } from 'src/theme/use-theme';

const THEMES: ReadonlyArray<{ value: ThemeName; label: string }> = [
  { value: 'pastel', label: '파스텔' },
  { value: 'paper', label: '수첩' },
  { value: 'night', label: '나이트' },
];

/** 그 테마로 보이는 작은 벤토 미리보기. 지금 적용 중인 모드의 토큰으로 그린다(CSS 변수는 현재 테마 값이라 쓰지 않는다). */
function MiniBento({ theme }: { theme: ThemeName }) {
  const { mode } = useResolvedTheme();
  const t = TOKENS[theme][mode];
  const block = (color: (typeof LABEL_COLORS)[number], extra: object) => ({
    borderRadius: `${Math.round(t.radius.sm / 2)}px`,
    bgcolor: t.label[color].fill,
    ...extra,
  });
  return (
    <Box
      aria-hidden="true"
      sx={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr',
        gridTemplateRows: '1fr 1fr',
        gap: '4px',
        height: 64,
        p: '6px',
        borderRadius: `${Math.round(t.radius.md / 2)}px`,
        border: `1px solid ${t.border}`,
        bgcolor: t.bg.base,
      }}
    >
      <Box sx={block('red', { gridRow: '1 / span 2' })} />
      <Box sx={block('teal', {})} />
      <Box
        sx={{ borderRadius: `${Math.round(t.radius.sm / 2)}px`, background: t.accent.gradient }}
      />
    </Box>
  );
}

type Props = { value: ThemeName; onChange(theme: ThemeName): void };

/** 테마 3종. 미리보기 카드를 눌러 고른다. */
export function ThemePicker({ value, onChange }: Props) {
  return (
    <Box
      role="radiogroup"
      aria-label="테마"
      sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}
    >
      {THEMES.map(({ value: theme, label }) => {
        const checked = theme === value;
        return (
          <Box
            key={theme}
            component="button"
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(theme)}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0.75,
              minHeight: 44,
              p: 0.75,
              border: '2px solid',
              borderColor: checked ? 'var(--tm-accent-main)' : 'var(--tm-border)',
              borderRadius: 'var(--tm-radius-md)',
              bgcolor: 'var(--tm-bg-surface)',
              color: 'var(--tm-text-primary)',
              font: 'inherit',
              fontWeight: checked ? 800 : 600,
              cursor: 'pointer',
              '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: 2 },
            }}
          >
            <MiniBento theme={theme} />
            <Box component="span">{label}</Box>
          </Box>
        );
      })}
    </Box>
  );
}
