import Typography from '@mui/material/Typography';
import type { DayTotals as Totals } from 'src/domain/day-totals';
import { formatTotals } from 'src/sections/itinerary/store/format';

/** Day 합계 줄(§4.4). 계산된 구간만 더하고 미계산 구간 수를 함께 보여 준다. */
export function DayTotals({ totals }: { totals: Totals }) {
  return (
    <Typography variant="body2" sx={{ fontWeight: 600, mt: 1 }} data-testid="day-totals">
      {formatTotals(totals)}
    </Typography>
  );
}
