import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useId } from 'react';
import { receivedTripTitle } from 'src/domain/library/import-share-trip';
import type { ShareTrip } from 'src/schema/share';
import { periodLabel } from 'src/sections/trips/trip-dates';

/**
 * 받은 v2 파일의 여행 칸(스펙 §7.2): 제목·기간·개수, `여행 계획도 가져오기` 스위치, 설명,
 * 같은 이름·기간의 여행이 이미 있을 때의 경고. 제목은 `h3`이다(화면 `h1`·창 제목을 더하지 않는다).
 */
export function ShareTripBox({
  trip,
  on,
  onChange,
  duplicate,
}: {
  trip: ShareTrip;
  on: boolean;
  onChange(on: boolean): void;
  duplicate: boolean;
}) {
  const noteId = useId();
  const stops = trip.days.reduce((sum, day) => sum + day.stops.length, 0);
  const candidates = trip.candidateIds.length;
  const counts = candidates > 0 ? `일정 ${stops}곳 · 후보 ${candidates}곳` : `일정 ${stops}곳`;

  return (
    <Box
      sx={{
        mt: 2,
        p: 1.5,
        border: '1px solid var(--tm-border)',
        borderRadius: 1,
      }}
    >
      <Typography
        variant="subtitle1"
        component="h3"
        sx={{ fontWeight: 800, wordBreak: 'break-word' }}
      >
        {receivedTripTitle(trip.title)}
      </Typography>
      <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
        {periodLabel(trip.startDate, trip.endDate)}
      </Typography>
      <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
        {counts}
      </Typography>
      <FormControlLabel
        control={
          <Switch
            checked={on}
            slotProps={{ input: { 'aria-describedby': noteId } }}
            onChange={(event) => onChange(event.target.checked)}
          />
        }
        label="여행 계획도 가져오기"
        sx={{ minHeight: 44, mt: 0.5 }}
      />
      <Box id={noteId} sx={{ mt: 0, fontSize: 12, color: 'var(--tm-text-secondary)' }}>
        새 여행으로 만들어요. 이동 시간은 내 Landmark에서 다시 조회해요
      </Box>
      {duplicate && (
        <Alert severity="warning" variant="outlined" sx={{ mt: 1, fontSize: 13 }}>
          같은 이름·기간의 여행이 이미 있어요. 가져오면 하나 더 생겨요
        </Alert>
      )}
    </Box>
  );
}
