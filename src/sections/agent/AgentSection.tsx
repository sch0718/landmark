import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useAtom, useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { ServerBackupConfirmDialog } from 'src/sections/server-backup/ServerBackupConfirmDialog';
import {
  createAgentApi,
  sameOwner,
  type AgentApi,
  type AgentFailure,
  type AgentTokenView,
} from 'src/services/agent-inbox/api';
import { getSharedSyncStorage } from 'src/services/library-sync/shared-api';
import {
  readSession,
  readSyncMeta,
  SYNC_META_KEY,
  SYNC_SESSION_KEY,
} from 'src/services/library-sync/storage';
import { agentInboxOpenAtom } from 'src/stores/agent-inbox';
import { syncStatusAtom } from 'src/stores/sync-status';
import { AgentTokenDialog } from './AgentTokenDialog';
import { expiryLabel, lastUsedLabel, scopeLabel } from './agent-copy';

function failureText(reason: AgentFailure): string {
  return reason === 'off'
    ? '지금은 AI 연결을 쓸 수 없어요'
    : reason === 'offline'
      ? '인터넷 연결을 확인해 주세요'
      : 'AI 연결 정보를 불러오지 못했어요';
}

export function AgentSection(): JSX.Element | null {
  useAtomValue(syncStatusAtom);
  const [, changed] = useState(0);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === SYNC_META_KEY || event.key === SYNC_SESSION_KEY)
        changed((n) => n + 1);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const storage = getSharedSyncStorage();
  const userId = readSyncMeta(storage).userId;
  const sessionId = readSession(storage)?.sessionId ?? null;
  if (userId === null || sessionId === null) return null;
  // 계정이나 세션이 바뀌면 열려 있던 창과 이전 목록도 함께 버려요.
  return (
    <SignedInAgentSection key={`${userId}:${sessionId}`} userId={userId} sessionId={sessionId} />
  );
}

function SignedInAgentSection({ userId, sessionId }: { userId: string; sessionId: string }) {
  const api = useMemo(() => (userId && sessionId ? createAgentApi() : null), [userId, sessionId]);
  const [inboxOpen, setInboxOpen] = useAtom(agentInboxOpenAtom);
  const [info, setInfo] = useState<
    Extract<Awaited<ReturnType<AgentApi['tokens']>>, { ok: true }>['data'] | null
  >(null);
  const [inboxCount, setInboxCount] = useState(0);
  const [inboxFailed, setInboxFailed] = useState(false);
  const [now, setNow] = useState(() => new Date(Date.now()));
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<AgentFailure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<AgentTokenView | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusAfterRevoke = useRef(false);
  const [busy, setBusy] = useState(false);
  const refreshRun = useRef(0);
  const revokeRun = useRef(0);
  const busyRef = useRef(false);
  const currentOwner = useCallback(
    () =>
      api !== null &&
      sameOwner(api.owner) &&
      readSession(getSharedSyncStorage())?.sessionId === sessionId,
    [api, sessionId],
  );
  const refresh = useCallback(async () => {
    const run = ++refreshRun.current;
    const current = () => run === refreshRun.current && currentOwner();
    setLoading(true);
    setFailure(null);
    if (!api) {
      setFailure('off');
      setLoading(false);
      return;
    }
    try {
      const [tokens, inbox] = await Promise.allSettled([api.tokens(), api.inbox()]);
      if (!current()) return;
      setNow(new Date(Date.now()));
      if (tokens.status === 'rejected') setFailure('server');
      else if (tokens.value.ok) setInfo(tokens.value.data);
      else setFailure(tokens.value.reason);
      if (inbox.status === 'fulfilled' && inbox.value.ok) {
        setInboxCount(inbox.value.data.items.length);
        setInboxFailed(false);
      } else setInboxFailed(true);
    } catch {
      if (current()) setFailure('server');
    } finally {
      if (current()) setLoading(false);
    }
  }, [api, currentOwner]);
  useEffect(() => {
    let active = true;
    if (!inboxOpen)
      queueMicrotask(() => {
        if (active) void refresh();
      });
    return () => {
      active = false;
      refreshRun.current += 1;
    };
  }, [inboxOpen, refresh]);
  useEffect(
    () => () => {
      revokeRun.current += 1;
    },
    [],
  );
  const revoke = async () => {
    if (!api || !confirm || !confirmOpen || busyRef.current || !currentOwner()) return;
    const run = ++revokeRun.current;
    const current = () => run === revokeRun.current && currentOwner();
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.revoke(confirm.id);
      if (!current()) return;
      focusAfterRevoke.current = true;
      setConfirmOpen(false);
      if (result.ok) await refresh();
      else setError('연결을 철회하지 못했어요');
    } catch {
      if (current()) {
        focusAfterRevoke.current = true;
        setConfirmOpen(false);
        setError('연결을 철회하지 못했어요');
      }
    } finally {
      if (current()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  const active = (token: AgentTokenView) =>
    token.revokedAt === null && token.expiresAt > now.getTime();
  const full = info !== null && info.tokens.filter(active).length >= info.maxActive;
  const unavailable =
    info === null
      ? null
      : !info.enabled
        ? '지금은 AI 연결을 쓸 수 없어요'
        : !info.canCreate
          ? '동기화가 꺼져 있어 새 연결을 만들 수 없어요'
          : full
            ? '연결은 10개까지예요. 쓰지 않는 연결을 철회해 주세요'
            : null;
  return (
    <Box
      component="section"
      aria-label="AI 연결"
      sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      <Typography ref={heading} component="h3" tabIndex={-1} sx={{ fontSize: 14, fontWeight: 700 }}>
        AI 연결
      </Typography>
      <Typography variant="body2">
        Claude Code 같은 AI 도구가 일정을 받은함으로 보내거나 공유 짧은 링크를 만들 수 있게
        연결해요. 연결 토큰으로는 보관함을 읽거나 고칠 수 없어요. 받은 일정은 내가 「가져오기」를
        눌러야 보관함에 들어가요.
      </Typography>
      {loading ? (
        <Typography role="status" variant="body2">
          AI 연결 정보를 불러오는 중…
        </Typography>
      ) : failure ? (
        <>
          <Typography role="alert" variant="body2">
            {failureText(failure)}
          </Typography>
          <Button onClick={() => void refresh()} sx={{ minHeight: 44 }}>
            다시 시도
          </Button>
        </>
      ) : (
        <>
          {info?.tokens.map((token) => (
            <Box key={token.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography
                variant="body2"
                sx={{
                  flex: 1,
                  overflowWrap: 'anywhere',
                  ...(!active(token) ? { color: 'var(--tm-text-secondary)' } : {}),
                }}
              >
                {`${token.name} · ${scopeLabel(token.scopes)} · ${token.revokedAt !== null ? '철회됨' : token.expiresAt <= now.getTime() ? '만료됨' : expiryLabel(token.expiresAt, now)} · 마지막 사용 ${lastUsedLabel(token.lastUsedAt, now)}`}
              </Typography>
              {active(token) && (
                <Button
                  aria-label={`「${token.name}」 철회`}
                  disabled={busy}
                  onClick={() => {
                    setConfirm(token);
                    setConfirmOpen(true);
                  }}
                  sx={{ minHeight: 44, minWidth: 44 }}
                >
                  철회
                </Button>
              )}
            </Box>
          ))}
          {unavailable && <Typography variant="body2">{unavailable}</Typography>}
          <Button
            variant="outlined"
            disabled={!info || !info.enabled || !info.canCreate || full || busy}
            onClick={() => setCreating(true)}
            sx={{ minHeight: 44 }}
          >
            새 연결 만들기
          </Button>
          {inboxFailed ? (
            <Box>
              <Typography role="alert" variant="body2">
                받은 일정을 불러오지 못했어요
              </Typography>
              <Button onClick={() => void refresh()} sx={{ minHeight: 44 }}>
                다시 시도
              </Button>
            </Box>
          ) : inboxCount === 0 ? (
            <Typography variant="body2">받은 일정 없음</Typography>
          ) : (
            <Button
              onClick={() => setInboxOpen(true)}
              sx={{ minHeight: 44 }}
            >{`받은 일정 ${inboxCount}개 · 보기`}</Button>
          )}
        </>
      )}
      {error && (
        <Typography role="alert" variant="body2" color="error">
          {error}
        </Typography>
      )}
      <ServerBackupConfirmDialog
        open={confirmOpen}
        title={`「${confirm?.name ?? ''}」 연결을 철회할까요?`}
        body="이 토큰으로는 더 이상 일정을 보내거나 링크를 만들 수 없어요."
        confirmLabel="철회"
        busy={busy}
        onClose={() => setConfirmOpen(false)}
        onExited={() => {
          if (focusAfterRevoke.current) {
            focusAfterRevoke.current = false;
            heading.current?.focus({ preventScroll: true });
          }
        }}
        onConfirm={() => void revoke()}
      />
      {api && (
        <AgentTokenDialog
          open={creating}
          api={api}
          onClose={() => setCreating(false)}
          onIssued={() => void refresh()}
        />
      )}
    </Box>
  );
}
