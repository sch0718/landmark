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
function InboxContent({ onClose, titleId }: { onClose(): void; titleId: string }) {
  const [api] = useState(() => createAgentApi());
  const [now] = useState(() => new Date(Date.now()));
  const [items, setItems] = useState<InboxItemView[]>([]);
  const [loading, setLoading] = useState(api !== null);
  const [failed, setFailed] = useState(false);
  const [errors, setErrors] = useState<Record<string, RowError>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<InboxItemView | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const previewButtons = useRef(new Map<string, HTMLButtonElement>());
  const discardButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterDiscard = useRef<{ id: string | null; failed: boolean } | null>(null);
  const active = useRef(true);
  const running = useRef(false);
  const setFlow = useSetAtom(addFlowAtom);

  const current = useCallback(() => {
    if (!active.current || !api) return false;
    if (sameOwner(api.owner)) return true;
    active.current = false;
    closeRef.current();
    toast('로그인한 계정이 바뀌어 받은 일정을 닫았어요');
    return false;
  }, [api]);

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
      closeRef.current();
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
    if (!api || !confirm || !confirmOpen || running.current || !current()) return;
    const id = confirm.id;
    focusAfterDiscard.current = { id, failed: true };
    running.current = true;
    setBusy(true);
    try {
      const result = await api.discard(id);
      if (!current()) return;
      if (result.ok || result.reason === 'not-found') {
        const index = items.findIndex((row) => row.id === id);
        focusAfterDiscard.current = {
          id: (items[index + 1] ?? items[index - 1])?.id ?? null,
          failed: false,
        };
        setItems((previous) => previous.filter((row) => row.id !== id));
      } else toast('받은 일정을 버리지 못했어요');
    } catch {
      if (current()) toast('받은 일정을 버리지 못했어요');
    } finally {
      running.current = false;
      if (active.current) {
        setBusy(false);
        setConfirmOpen(false);
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
                      ref={(button: HTMLButtonElement | null) => {
                        if (button) previewButtons.current.set(item.id, button);
                        else previewButtons.current.delete(item.id);
                      }}
                      disabled={busy}
                      sx={{ minHeight: 44 }}
                      aria-label={`「${item.title}」 미리보기`}
                      onClick={() => void preview(item)}
                    >
                      미리보기
                    </Button>
                  )}
                  <Button
                    ref={(button: HTMLButtonElement | null) => {
                      if (button) discardButtons.current.set(item.id, button);
                      else discardButtons.current.delete(item.id);
                    }}
                    disabled={busy}
                    sx={{ minHeight: 44 }}
                    aria-label={`「${item.title}」 버리기`}
                    onClick={() => {
                      setConfirm(item);
                      setConfirmOpen(true);
                    }}
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
        open={confirmOpen}
        title="이 일정을 버릴까요?"
        body={`「${confirm?.title ?? ''}」 · 되살릴 수 없어요`}
        confirmLabel="버리기"
        busy={busy}
        onConfirm={() => void discard()}
        onClose={() => setConfirmOpen(false)}
        onExited={() => {
          const target = focusAfterDiscard.current;
          focusAfterDiscard.current = null;
          if (!active.current || !target) return;
          const button =
            target.id === null
              ? null
              : ((target.failed
                  ? discardButtons.current.get(target.id)
                  : previewButtons.current.get(target.id)) ??
                discardButtons.current.get(target.id));
          (button ?? document.getElementById(titleId))?.focus({ preventScroll: true });
        }}
      />
    </>
  );
}

export function AgentInboxDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const titleId = useId();
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId} fullWidth maxWidth="sm">
      <DialogTitle id={titleId} tabIndex={-1}>
        AI가 보낸 일정
      </DialogTitle>
      {open && <InboxContent onClose={onClose} titleId={titleId} />}
      <DialogActions>
        <Button onClick={onClose} sx={{ minHeight: 44 }}>
          닫기
        </Button>
      </DialogActions>
    </Dialog>
  );
}
