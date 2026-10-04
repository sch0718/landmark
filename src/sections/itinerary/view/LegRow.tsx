import Typography from '@mui/material/Typography';
import type { DisplayLeg } from 'src/domain/leg-index';
import { formatLeg } from 'src/sections/itinerary/store/format';

/** 장소 행 사이의 구간 행. 미계산 구간은 흐린 색으로 표시한다. */
export function LegRow({ leg }: { leg: DisplayLeg }) {
  return (
    <Typography
      component="li"
      variant="caption"
      color={leg.status === 'routed' ? 'text.secondary' : 'warning.main'}
      data-testid="leg-row"
      sx={{ display: 'block', pl: 5, py: 0.25, listStyle: 'none' }}
    >
      {formatLeg(leg)}
    </Typography>
  );
}
