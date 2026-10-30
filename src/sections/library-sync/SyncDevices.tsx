import { Box, Button, Typography } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import type { DeviceSession } from '@sch0718/firebase-session/client';
import type { MeReply } from 'src/services/library-sync/api';
import { syncServices } from './sync-copy';
export function SyncDevices() {
  const services = useMemo(() => syncServices(), []);
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [devices, setDevices] = useState<MeReply['devices']>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    if (services)
      void Promise.all([services.api.client.listSessions(), services.api.me()])
        .then(([s, m]) => {
          if (!live) return;
          if (s.ok) setSessions(s.data.sessions);
          else setError('기기 목록을 읽지 못했어요');
          if (m.ok) setDevices(m.data.devices);
        })
        .catch(() => {
          if (live) setError('기기 목록을 읽지 못했어요');
        });
    return () => {
      live = false;
    };
  }, [services]);
  const revoke = async (id: string) => {
    if (!services) return;
    setBusy(true);
    try {
      const reply = await services.api.client.revokeSession(id);
      if (reply.ok) setSessions((s) => s.filter((s) => s.id !== id));
      else setError('기기 연결을 끊지 못했어요');
    } catch {
      setError('기기 연결을 끊지 못했어요');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box>
      <Typography fontWeight={700}>연결된 기기</Typography>
      {sessions.map((s) => (
        <Box key={s.id} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          <Typography>
            {s.label}
            {s.current ? ' · 이 기기' : ''}
          </Typography>
          <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
            {new Date(
              devices.find((d) => d.sessionId === s.id)?.lastSyncAt ?? s.lastUsedAt,
            ).toLocaleString('ko-KR')}
          </Typography>
          {!s.current && (
            <Button
              disabled={busy}
              onClick={() => {
                void revoke(s.id);
              }}
              sx={{ minHeight: 44 }}
            >
              연결 끊기
            </Button>
          )}
        </Box>
      ))}
      {error && <Typography role="alert">{error}</Typography>}
    </Box>
  );
}
