import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  createAgentApi,
  sameOwner,
  type AgentChangeView,
  type UndoInput,
} from 'src/services/agent-inbox/api';
import { loadSyncEngine } from 'src/services/library-sync/boot';
import { changeLine, changeTitle } from './agent-copy';

const NOTES: Record<string, string> = {
  changed: '그 사이 바뀌어서 그대로 뒀어요',
  gone: '기록이 만료돼 되돌릴 수 없어요',
  already: '이미 되돌렸어요',
};

/** 열린 동안만 API와 기록을 보관하고, 닫은 뒤 도착한 응답은 버려요. */
function ChangesContent() {
  const [api] = useState(() => createAgentApi());
  const [now] = useState(() => new Date(Date.now()));
  const [changes, setChanges] = useState<AgentChangeView[]>([]);
  const [loading, setLoading] = useState(api !== null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const running = useRef(false);

  const refresh = useCallback(async () => {
    if (!api || !active.current || !sameOwner(api.owner)) return;
    setLoading(true);
    setFailed(false);
    try {
      const result = await api.changes();
      if (!active.current) return;
      if (result.ok) setChanges(result.data.changes);
      else setFailed(true);
    } catch {
      if (active.current) setFailed(true);
    } finally {
      if (active.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    active.current = true;
    queueMicrotask(() => {
      if (active.current) void refresh();
    });
    return () => {
      active.current = false;
    };
  }, [refresh]);

  async function undo(input: UndoInput) {
    if (!api || running.current || !sameOwner(api.owner)) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.undo(input);
      if (!active.current) return;
      if (!result.ok) {
        setError('되돌리지 못했어요. 다시 시도해 주세요');
        return;
      }
      const next: Record<string, string> = {};
      for (const { id, status } of result.data.results) {
        const note = NOTES[status];
        if (note) next[id] = note;
      }
      setNotes((previous) => ({ ...previous, ...next }));
      await refresh();
      void loadSyncEngine()
        .then((module) => module.ensureLibrarySyncEngine().schedule('manual'))
        .catch(() => {});
    } catch {
      if (active.current) setError('되돌리지 못했어요. 다시 시도해 주세요');
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }

  const groups = new Map<string, AgentChangeView[]>();
  for (const change of changes) {
    groups.set(change.requestId, [...(groups.get(change.requestId) ?? []), change]);
  }

  return (
    <DialogContent>
      <Typography variant="body2" sx={{ mb: 1 }}>
        같은 항목은 가장 최근 변경만 되돌릴 수 있어요
      </Typography>
      {!api ? (
        <Typography>지금은 변경 기록을 볼 수 없어요</Typography>
      ) : loading ? (
        <Typography role="status">변경 기록을 불러오는 중…</Typography>
      ) : failed ? (
        <>
          <Typography role="alert">변경 기록을 불러오지 못했어요. 다시 시도해 주세요</Typography>
          <Button sx={{ minHeight: 44 }} onClick={() => void refresh()}>
            다시 시도
          </Button>
        </>
      ) : changes.length === 0 ? (
        <Typography>AI 변경 기록이 없어요</Typography>
      ) : (
        <>
          {error && (
            <Typography role="alert" color="error">
              {error}
            </Typography>
          )}
          {[...groups.entries()].map(([requestId, rows]) => (
            <Box key={requestId} component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {rows.filter((row) => row.undoneAt === null).length > 1 && (
                <Box component="li">
                  <Button
                    disabled={busy}
                    sx={{ minHeight: 44 }}
                    onClick={() => void undo({ requestId })}
                  >
                    모두 되돌리기
                  </Button>
                </Box>
              )}
              {rows.map((row) => (
                <Box component="li" key={row.id} sx={{ py: 1.5 }}>
                  <Typography sx={{ overflowWrap: 'anywhere' }}>{changeTitle(row)}</Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ overflowWrap: 'anywhere' }}
                  >
                    {changeLine(row, now)}
                  </Typography>
                  {notes[row.id] && row.undoneAt === null && (
                    <Typography variant="body2">{notes[row.id]}</Typography>
                  )}
                  <Button
                    disabled={busy || row.undoneAt !== null}
                    sx={{ minHeight: 44 }}
                    aria-label={`「${row.label}」 되돌리기`}
                    onClick={() => void undo({ ids: [row.id] })}
                  >
                    되돌리기
                  </Button>
                </Box>
              ))}
            </Box>
          ))}
        </>
      )}
    </DialogContent>
  );
}

export function AgentChangesDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const titleId = useId();
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId} fullWidth maxWidth="sm">
      <DialogTitle id={titleId} tabIndex={-1}>
        AI 변경 기록
      </DialogTitle>
      {open && <ChangesContent />}
      <DialogActions>
        <Button onClick={onClose} sx={{ minHeight: 44 }}>
          닫기
        </Button>
      </DialogActions>
    </Dialog>
  );
}
