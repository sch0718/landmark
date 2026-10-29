import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { loadSyncEngine } from 'src/services/library-sync/boot';
export function SyncDeleteDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    try {
      if (await (await loadSyncEngine()).ensureLibrarySyncEngine().deleteServerData()) {
        setConfirm('');
        onClose();
      } else setError('서버 자료를 지우지 못했어요. 잠시 뒤 다시 해 주세요');
    } catch {
      setError('서버 자료를 지우지 못했어요. 잠시 뒤 다시 해 주세요');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="sync-delete-title"
    >
      <DialogTitle id="sync-delete-title">서버 자료 모두 지우기</DialogTitle>
      <DialogContent>
        <Typography>
          서버에 있는 이 계정의 보관함과 기기 연결을 모두 지워요. 기기 안의 보관함은 그대로예요.
        </Typography>
        <TextField
          label="지우기 입력"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={busy}
          fullWidth
          sx={{ mt: 2 }}
        />
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy} sx={{ minHeight: 44 }}>
          취소
        </Button>
        <Button
          color="error"
          disabled={busy || confirm !== '지우기'}
          onClick={() => {
            void remove();
          }}
          sx={{ minHeight: 44 }}
        >
          서버 자료 모두 지우기
        </Button>
      </DialogActions>
    </Dialog>
  );
}
