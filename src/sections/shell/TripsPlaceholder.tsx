import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

/** `/trips` 자리. 여행 계획은 다음 단계에서 만든다. */
export function TripsPlaceholder() {
  return (
    <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
      <Typography component="p">여행 계획은 곧 제공돼요</Typography>
    </Box>
  );
}
