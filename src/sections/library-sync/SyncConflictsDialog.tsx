import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { getItem, parseItemKey } from 'src/domain/library-sync/items';
import { loadSyncEngine } from 'src/services/library-sync/boot';
import { readConflicts, readSyncMeta } from 'src/services/library-sync/storage';
import { libraryAtom } from 'src/stores/library-state';
import { syncStatusAtom } from 'src/stores/sync-status';
import { conflictPath, REJECTED_COPY, shortValue } from './sync-copy';
export function SyncConflictsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  useAtomValue(syncStatusAtom);
  const lib = useAtomValue(libraryAtom);
  const [, refresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conflicts = readConflicts(localStorage);
  const meta = readSyncMeta(localStorage);
  const run = async (
    action: (
      engine: ReturnType<Awaited<ReturnType<typeof loadSyncEngine>>['ensureLibrarySyncEngine']>,
    ) => Promise<void>,
  ) => {
    setBusy(true);
    setError(null);
    try {
      await action((await loadSyncEngine()).ensureLibrarySyncEngine());
      refresh((n) => n + 1);
    } catch {
      setError('변경을 적용하지 못했어요. 충돌을 남겨 두었어요.');
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
      aria-labelledby="sync-conflicts-title"
    >
      <DialogTitle id="sync-conflicts-title">확인 필요한 충돌</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2 }}>
        {conflicts.map((c) => (
          <Box key={c.id}>
            <Typography fontWeight={700}>
              {c.label} · {conflictPath(c.path)}
            </Typography>
            <Typography variant="body2">이 기기 값: {shortValue(c.mine)}</Typography>
            <Typography variant="body2">남은 값: {shortValue(c.theirs)}</Typography>
            <Button
              disabled={busy}
              onClick={() => {
                void run((e) => e.resolveConflict(c.id, 'mine'));
              }}
              sx={{ minHeight: 44 }}
            >
              내 값으로 되돌리기
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                void run((e) => e.resolveConflict(c.id, 'keep'));
              }}
              sx={{ minHeight: 44 }}
            >
              그대로 두기
            </Button>
          </Box>
        ))}
        {meta.held.length > 0 && <Typography fontWeight={700}>이 기기에 넣지 못한 항목</Typography>}
        {meta.held.map((h) => {
          const p = parseItemKey(h.key);
          const mine = p && getItem(lib, p.kind, p.id);
          return (
            <Box key={h.key}>
              <Typography>{h.key}</Typography>
              {mine && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    void run((e) => e.resolveHeld(h.key, 'mine'));
                  }}
                  sx={{ minHeight: 44 }}
                >
                  이 기기 값으로 맞추기
                </Button>
              )}
              <Button
                disabled={busy}
                onClick={() => {
                  void run((e) => e.resolveHeld(h.key, 'skip'));
                }}
                sx={{ minHeight: 44 }}
              >
                건너뛰기
              </Button>
            </Box>
          );
        })}
        {meta.rejected.map((r) => (
          <Typography key={r.key}>
            {r.key}: {REJECTED_COPY[r.reason]}
          </Typography>
        ))}
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose} sx={{ minHeight: 44 }}>
          닫기
        </Button>
      </DialogActions>
    </Dialog>
  );
}
