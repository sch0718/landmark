import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

type Props = { title: string; actionLabel: string; onAction(): void };

/** 빈 목록 안내와 한 가지 다음 행동. */
export function EmptyState({ title, actionLabel, onAction }: Props) {
  return (
    <Box
      role="status"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1.5,
        px: 3,
        py: 6,
        textAlign: 'center',
      }}
    >
      <Typography component="p" sx={{ fontWeight: 800, color: 'var(--tm-text-primary)' }}>
        {title}
      </Typography>
      <Button variant="contained" onClick={onAction} sx={{ minHeight: 44 }}>
        {actionLabel}
      </Button>
    </Box>
  );
}
