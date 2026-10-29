import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { toast } from 'sonner';
import { formatShortExpiry } from 'src/domain/share/short-link';
import { tripLiveApi } from 'src/services/trip-live/client';
import {
  tripLiveStore,
  useTripLiveRecords,
  type TripLiveRecord,
} from 'src/services/trip-live/store';
export function LiveTripsSection() {
  const records = useTripLiveRecords(),
    [busy, setBusy] = useState<string | null>(null);
  if (!records.length) return null;
  async function remove(record: TripLiveRecord) {
    if (busy !== null) return;
    setBusy(record.tripId);
    const result =
      record.status === 'live' || record.status === 'pending'
        ? await tripLiveApi.remove(record.liveId, record.ownerToken)
        : { ok: true as const };
    setBusy(null);
    if (result.ok) {
      tripLiveStore.remove(record.tripId);
      toast('갱신 링크를 지웠어요');
    } else
      toast.error(
        result.error === 'offline'
          ? '인터넷 연결을 확인하고 다시 해 주세요'
          : '갱신 링크를 지우지 못했어요. 잠시 뒤 다시 해 주세요',
      );
  }
  const status = (record: TripLiveRecord) =>
    record.status === 'pending'
      ? '만드는 중 멈춤'
      : record.status === 'disconnected'
        ? '관리 연결 끊김'
        : record.status === 'ended'
          ? '끝남'
          : record.expiresAt
            ? `${formatShortExpiry(new Date(record.expiresAt), new Date())}까지`
            : '기한 확인 중';
  return (
    <Box
      component="section"
      aria-label="갱신 링크"
      sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      <Typography component="h2" sx={{ fontSize: 15, fontWeight: 800 }}>
        갱신 링크
      </Typography>
      <Typography variant="body2">
        이 기기에서 만든·연결한 갱신 링크예요. 지우면 받은 사람도 더는 볼 수 없어요. 서버에는
        암호화하지 않고 저장해요
      </Typography>
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {records.map((record) => (
          <Box
            component="li"
            key={record.tripId}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 44 }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2">{record.options.title}</Typography>
              <Typography variant="caption">{status(record)}</Typography>
            </Box>
            <Button
              disabled={busy !== null}
              color="error"
              aria-label={`${record.options.title} 링크 지우기`}
              onClick={() => void remove(record)}
              sx={{ minHeight: 44 }}
            >
              지우기
            </Button>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
