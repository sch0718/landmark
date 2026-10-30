import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Typography,
} from '@mui/material';
import { useAtomValue } from 'jotai';
import { useEffect, useMemo, useState } from 'react';
import { libraryCounts } from 'src/domain/backup/summary';
import { loadSyncEngine } from 'src/services/library-sync/boot';
import { libraryAtom } from 'src/stores/library-state';
import { syncStatusAtom } from 'src/stores/sync-status';
import { syncServices } from './sync-copy';
export function SyncConnectDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const services = useMemo(() => syncServices(), []);
  const lib = useAtomValue(libraryAtom);
  const status = useAtomValue(syncStatusAtom);
  const [server, setServer] = useState<number | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace-local'>('merge');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counts = libraryCounts(lib);
  const localCountsText = `장소 ${counts.places}곳 · 라벨 ${counts.labels}개 · 여행 ${counts.trips}개 · 약속 ${counts.meetings}개`;
  const localCount = Object.values(counts).reduce((a, b) => a + b, 0);
  useEffect(() => {
    if (!open || !services) return;
    let live = true;
    void services.api
      .me()
      .then((reply) => {
        if (!live) return;
        if (reply.ok) setServer(reply.data.library.live);
        else setError('서버 보관함을 읽지 못했어요');
      })
      .catch(() => {
        if (live) setError('서버 보관함을 읽지 못했어요');
      });
    return () => {
      live = false;
    };
  }, [open, services]);
  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const engine = (await loadSyncEngine()).ensureLibrarySyncEngine();
      const result = await engine.connect(
        server === 0 ? 'upload' : localCount === 0 ? 'merge' : mode,
      );
      if (['synced', 'conflict', 'local'].includes(result.phase)) onClose();
      else setError(result.message ?? '연결하지 못했어요. 잠시 뒤 다시 해 주세요');
    } catch {
      setError('연결하지 못했어요. 잠시 뒤 다시 해 주세요');
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      await (await loadSyncEngine()).ensureLibrarySyncEngine().disconnect();
      onClose();
    } catch {
      setError('연결 해제를 확인하지 못했어요');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={
        busy
          ? undefined
          : () => {
              void cancel();
            }
      }
      fullWidth
      maxWidth="sm"
      aria-labelledby="sync-connect-title"
    >
      <DialogTitle id="sync-connect-title">연결 방식</DialogTitle>
      <DialogContent>
        <Typography>이 기기 보관함: {localCountsText}</Typography>
        {server !== null && <Typography>서버 보관함: 항목 {server}개</Typography>}
        {server === 0 ? (
          <Typography>이 기기 보관함을 올릴까요?</Typography>
        ) : localCount === 0 ? (
          <Typography>서버 보관함을 이 기기로 받아요.</Typography>
        ) : (
          server !== null && (
            <>
              <RadioGroup value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <FormControlLabel value="merge" control={<Radio />} label="합치기(권장)" />
                <FormControlLabel
                  value="replace-local"
                  control={<Radio />}
                  label="서버 보관함으로 바꾸기"
                />
              </RadioGroup>
              <Typography variant="body2">
                합치면 같은 항목은 필드마다 더 최근 값을 써요. 서버 것으로 바꾸면 지금 보관함은
                되살리기 사본으로 남아요.
              </Typography>
            </>
          )
        )}
        {busy && (
          <Typography role="status">
            {status.progress?.step === 'push'
              ? `올리는 중 ${status.progress.done}/${status.progress.total}`
              : '받는 중'}
          </Typography>
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button
          disabled={busy}
          onClick={() => {
            void cancel();
          }}
          sx={{ minHeight: 44 }}
        >
          취소
        </Button>
        <Button
          disabled={busy || server === null}
          onClick={() => {
            void connect();
          }}
          sx={{ minHeight: 44 }}
        >
          {server === 0 ? '올리기' : localCount === 0 ? '서버 보관함 받기' : '계속'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
