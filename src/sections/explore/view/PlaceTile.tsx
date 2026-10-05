import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import CalendarPlusIcon from '~icons/mdi/calendar-plus';
import type { PlaceSummary } from '../store/place-summary';

export function PlaceTile({
  summary,
  onOpen,
  onAdd,
}: {
  summary: PlaceSummary;
  onOpen(): void;
  onAdd(): void;
}) {
  return (
    <Box
      component="article"
      sx={{
        borderRadius: 3,
        overflow: 'hidden',
        border: '1px solid #ebe7f2',
        bgcolor: '#fff',
        color: '#25212f',
        minWidth: 0,
      }}
    >
      <Button
        aria-label={`${summary.name} 상세`}
        onClick={onOpen}
        sx={{ display: 'block', textAlign: 'left', width: '100%', p: 0, color: 'inherit' }}
      >
        <Box
          sx={{
            height: 72,
            bgcolor: '#f0ecfa',
            color: '#25212f',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
          }}
        >
          {summary.emoji}
        </Box>
        <Box sx={{ p: 1.25, pb: 0 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 700, overflowWrap: 'anywhere' }}>
            {summary.name}
          </Typography>
          <Typography variant="caption">
            {summary.category} · 💬 {summary.memoCount}
            {summary.hidden ? ' · 숨김' : ''}
          </Typography>
          <Typography variant="caption" component="div" noWrap>
            {summary.memoPreview || '메모 없음'}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
            {summary.dayLabels.slice(0, 2).map((label) => (
              <Chip key={label} size="small" label={label} />
            ))}
            {summary.dayLabels.length > 2 && (
              <Typography variant="caption">+{summary.dayLabels.length - 2}</Typography>
            )}
          </Box>
        </Box>
      </Button>
      <Button
        aria-label={`${summary.name} 일정에 추가`}
        onClick={onAdd}
        startIcon={<CalendarPlusIcon width={20} height={20} />}
        sx={{ fontSize: 12, minHeight: 44 }}
      >
        일정에 추가
      </Button>
    </Box>
  );
}
