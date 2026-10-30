import { useTripCollabRecord } from 'src/services/trip-collab/store';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { TripLiveShareDialog } from 'src/routes/lazy-routes';
import { LazyDialogHost } from 'src/sections/share-export/LazyDialogHost';
import { useTripLiveRecord } from 'src/services/trip-live/store';
export function LiveShareEntry({ tripId }: { tripId: string }) {
  const [open, setOpen] = useState(false),
    record = useTripLiveRecord(tripId);
  const editor = useTripCollabRecord(tripId)?.role === 'editor';
  if (editor)
    return <Typography>함께 편집 중인 여행의 갱신 링크는 만든 사람이 관리해요</Typography>;
  const live = record?.status === 'live',
    disconnected = record?.status === 'disconnected';
  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="body2">
        {live
          ? '갱신 링크로 공유 중이에요'
          : disconnected
            ? '갱신 링크 관리 연결이 끊겼어요'
            : '받은 사람 화면도 일정을 고치면 바뀌는 링크를 만들 수 있어요'}
      </Typography>
      <Button onClick={() => setOpen(true)} sx={{ minHeight: 44 }}>
        {live ? '갱신 링크 관리' : '갱신 링크…'}
      </Button>
      <LazyDialogHost open={open} onClose={() => setOpen(false)} heading="갱신 링크">
        <TripLiveShareDialog
          key={tripId}
          open={open}
          onClose={() => setOpen(false)}
          tripId={tripId}
        />
      </LazyDialogHost>
    </Box>
  );
}
