import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { toast } from 'sonner';
import { tripCollabApi } from 'src/services/trip-collab/client';
import {
  tripCollabStore,
  useTripCollabRecords,
  type TripCollabRecord,
} from 'src/services/trip-collab/store';

export function CollabTripsSection() {
  const records = useTripCollabRecords();
  const [leaving, setLeaving] = useState<TripCollabRecord | null>(null);
  const [busy, setBusy] = useState(false);
  if (!records.length) return null;
  const leave = async () => {
    if (!leaving?.token || busy) return;
    setBusy(true);
    try {
      const result = await tripCollabApi.removeMember(leaving.liveId, leaving.token, 'me');
      setLeaving(null);
      if (result.ok) {
        tripCollabStore.remove(leaving.tripId);
        toast('함께 편집을 그만뒀어요');
      } else toast.error('인터넷 연결을 확인하고 다시 해 주세요');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box
      component="section"
      aria-label="함께 편집"
      sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      <Typography component="h2" sx={{ fontSize: 15, fontWeight: 800 }}>
        함께 편집
      </Typography>
      <Typography variant="body2">
        이 기기에서 함께 고치는 여행이에요. 공동 여행은 서버에 암호화하지 않고 저장해요
      </Typography>
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {records.map((record) => (
          <Box
            component="li"
            key={record.tripId}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 44 }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2">{record.title}</Typography>
              <Typography variant="caption">
                {record.role === 'owner' ? '만든 사람' : `${record.label}로 참여`}
                {record.status === 'revoked'
                  ? ' · 편집 권한이 거둬짐'
                  : record.status === 'ended'
                    ? ' · 끝남'
                    : ''}
              </Typography>
            </Box>
            {record.status !== 'live' ? (
              <Button
                color="error"
                sx={{ minHeight: 44 }}
                onClick={() => tripCollabStore.remove(record.tripId)}
              >
                목록에서 지우기
              </Button>
            ) : (
              record.role === 'editor' && (
                <Button
                  color="error"
                  sx={{ minHeight: 44 }}
                  disabled={busy}
                  onClick={() => setLeaving(record)}
                >
                  그만두기
                </Button>
              )
            )}
          </Box>
        ))}
      </Box>
      <Dialog
        open={leaving !== null}
        onClose={() => !busy && setLeaving(null)}
        aria-labelledby="leave-collab-title"
      >
        <DialogTitle id="leave-collab-title">함께 편집을 그만둘까요?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            이 기기의 여행은 남고, 다른 기기와 더는 맞추지 않아요. 다시 함께 고치려면 새 초대를
            받아야 해요.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setLeaving(null)} sx={{ minHeight: 44 }}>
            취소
          </Button>
          <Button disabled={busy} color="error" onClick={() => void leave()} sx={{ minHeight: 44 }}>
            그만두기
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
