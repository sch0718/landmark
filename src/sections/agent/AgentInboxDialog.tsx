import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { useSetAtom } from 'jotai';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { readShareHash, SHARE_READ_MESSAGES } from 'src/domain/share/read-share';
import { ServerBackupConfirmDialog } from 'src/sections/server-backup/ServerBackupConfirmDialog';
import { createAgentApi, sameOwner, type InboxItemView } from 'src/services/agent-inbox/api';
import { SYNC_META_KEY, SYNC_SESSION_KEY } from 'src/services/library-sync/storage';
import { addFlowAtom } from 'src/stores/add-place';
import { fromLine, inboxLine } from './agent-copy';

type RowError = { message: string; invalid: boolean };

/** 열린 동안만 API와 받은 결과를 보관하고, 닫은 뒤 도착한 응답은 버려요. */
function InboxContent({ onClose }: { onClose(): void }) {
  const [api] = useState(() => createAgentApi());
  const [now] = useState(() => new Date(Date.now()));
  const [items, setItems] = useState<InboxItemView[]>([]);
  const [loading, setLoading] = useState(api !== null);
  const [failed, setFailed] = useState(false);
  const [errors, setErrors] = useState<Record<string, RowError>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<InboxItemView | null>(null);
  const active = useRef(true);
  const running = useRef(false);
  const setFlow = useSetAtom(addFlowAtom);

  const current = useCallback(() => {
    if (!active.current || !api) return false;
    if (sameOwner(api.owner)) return true;
    active.current = false;
    onClose();
    toast('로그인한 계정이 바뀌어 받은 일정을 닫았어요');
    return false;
  }, [api, onClose]);

  const refresh = useCallback(async () => {
    if (!api || !current()) return;
    setLoading(true);
    setFailed(false);
    try {
      const result = await api.inbox();
      if (!current()) return;
      if (result.ok) setItems(result.data.items);
      else setFailed(true);
    } catch {
      if (current()) setFailed(true);
    } finally {
      if (active.current) setLoading(false);
    }
  }, [api, current]);

  useEffect(() => {
    active.current = true;
    queueMicrotask(() => {
      if (active.current) void refresh();
    });
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key === SYNC_META_KEY || event.key === SYNC_SESSION_KEY)
        current();
    };
    window.addEventListener('storage', changed);
    return () => {
      active.current = false;
      window.removeEventListener('storage', changed);
    };
  }, [refresh, current]);

  function rowError(id: string, message: string, invalid = false) {
    setErrors((previous) => ({ ...previous, [id]: { message, invalid } }));
  }

  async function preview(item: InboxItemView) {
    if (!api || running.current || !current()) return;
    running.current = true;
    setBusy(true);
    try {
      const result = await api.item(item.id);
      if (!current()) return;
      if (!result.ok) {
        if (result.reason === 'not-found') {
          setItems((previous) => previous.filter((row) => row.id !== item.id));
          toast('이미 없는 일정이에요');
        } else rowError(item.id, '받은 일정을 읽지 못했어요. 다시 시도해 주세요');
        return;
      }
      const read = await readShareHash(result.data.data);
      if (!current()) return;
      if (!read.ok) {
        rowError(item.id, SHARE_READ_MESSAGES[read.error], true);
        return;
      }
      active.current = false;
      onClose();
      setFlow({
        step: 'share',
        doc: read.doc,
        inbox: { id: item.id, from: item.from, owner: api.owner },
      });
    } catch {
      if (current()) rowError(item.id, '받은 일정을 읽지 못했어요. 다시 시도해 주세요');
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }

  async function discard() {
    if (!api || !confirm || running.current || !current()) return;
    const id = confirm.id;
    running.current = true;
    setBusy(true);
    try {
      const result = await api.discard(id);
      if (!current()) return;
      if (result.ok || result.reason === 'not-found') {
        setItems((previous) => previous.filter((row) => row.id !== id));
      } else toast('받은 일정을 버리지 못했어요');
    } catch {
      if (current()) toast('받은 일정을 버리지 못했어요');
    } finally {
      running.current = false;
      if (active.current) {
        setBusy(false);
        setConfirm(null);
      }
    }
  }

  return (
    <>
      <DialogContent>
        {!api ? (
          <Typography>지금은 받은 일정을 볼 수 없어요</Typography>
        ) : loading ? (
          <Typography role="status">받은 일정을 불러오는 중…</Typography>
        ) : failed ? (
          <>
            <Typography role="alert">받은 일정을 불러오지 못했어요. 다시 시도해 주세요</Typography>
            <Button sx={{ minHeight: 44 }} onClick={() => void refresh()}>
              다시 시도
            </Button>
          </>
        ) : items.length === 0 ? (
          <Typography>받은 일정이 없어요</Typography>
        ) : (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {items.map((item) => (
              <Box component="li" key={item.id} sx={{ py: 1.5 }}>
                <Typography sx={{ overflowWrap: 'anywhere' }}>{inboxLine(item, now)}</Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ overflowWrap: 'anywhere' }}
                >
                  {fromLine(item, now)}
                </Typography>
                {errors[item.id] && (
                  <Typography role="alert" color="error">
                    {errors[item.id]?.message}
                  </Typography>
                )}
                <Box sx={{ display: 'flex', gap: 1 }}>
                  {!errors[item.id]?.invalid && (
                    <Button
                      disabled={busy}
                      sx={{ minHeight: 44 }}
                      aria-label={`「${item.title}」 미리보기`}
                      onClick={() => void preview(item)}
                    >
                      미리보기
                    </Button>
                  )}
                  <Button
                    disabled={busy}
                    sx={{ minHeight: 44 }}
                    aria-label={`「${item.title}」 버리기`}
                    onClick={() => setConfirm(item)}
                  >
                    버리기
                  </Button>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <ServerBackupConfirmDialog
        open={confirm !== null}
        title="이 일정을 버릴까요?"
        body="되살릴 수 없어요"
        confirmLabel="버리기"
        busy={busy}
        onConfirm={() => void discard()}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}

export function AgentInboxDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const titleId = useId();
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId} fullWidth maxWidth="sm">
      <DialogTitle id={titleId}>AI가 보낸 일정</DialogTitle>
      {open && <InboxContent onClose={onClose} />}
      <DialogActions>
        <Button onClick={onClose} sx={{ minHeight: 44 }}>
          닫기
        </Button>
      </DialogActions>
    </Dialog>
  );
}
