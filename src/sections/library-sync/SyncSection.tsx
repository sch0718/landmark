import { Alert, Box, Button, Typography } from '@mui/material';
import { useAtomValue } from 'jotai';
import { useEffect, useMemo, useState } from 'react';
import { useBackupFile } from 'src/sections/backup/use-backup-file';
import { loadSyncEngine } from 'src/services/library-sync/boot';
import {
  deviceLabel,
  googleLogin,
  googleRedirectResult,
  startSocialLogin,
  type LoginOutcome,
} from 'src/services/library-sync/login';
import type { StatusReply } from 'src/services/library-sync/api';
import { readSession, readSyncMeta } from 'src/services/library-sync/storage';
import { syncPhaseText, syncStatusAtom } from 'src/stores/sync-status';
import type { LibrarySyncEngine } from 'src/services/library-sync/sync-engine';
import { SyncConnectDialog } from './SyncConnectDialog';
import { SyncConflictsDialog } from './SyncConflictsDialog';
import { SyncDeleteDialog } from './SyncDeleteDialog';
import { SyncDevices } from './SyncDevices';
import { SYNC_DESCRIPTION, syncServices } from './sync-copy';
export default function SyncSection() {
  const services = useMemo(() => syncServices(), []);
  const status = useAtomValue(syncStatusAtom);
  const backup = useBackupFile();
  const [, refresh] = useState(0);
  const meta = readSyncMeta(localStorage);
  const session = readSession(localStorage);
  const [server, setServer] = useState<StatusReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loginOutcome, setLoginOutcome] = useState<LoginOutcome | null>(null);
  const [connectOpen, setConnectOpen] = useState(meta.pendingChoice);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const handleLogin = async (outcome: LoginOutcome) => {
    setLoginOutcome(outcome);
    if (outcome.ok) {
      refresh((n) => n + 1);
      if (outcome.next === 'choose') setConnectOpen(true);
      else (await loadSyncEngine()).ensureLibrarySyncEngine().start();
    }
  };
  useEffect(() => {
    let live = true;
    if (services) {
      void services.api
        .status()
        .then((reply) => {
          if (!live) return;
          if (reply.ok) setServer(reply.data);
          else setError('동기화 서버에 연결하지 못했어요');
        })
        .catch(() => {
          if (live) setError('동기화 서버에 연결하지 못했어요');
        });
      if (services.auth && !readSession(localStorage))
        void googleRedirectResult(
          services.api,
          services.auth,
          localStorage,
          deviceLabel(navigator.userAgent),
        ).then((outcome) => {
          if (live && outcome.ok) {
            refresh((n) => n + 1);
            if (outcome.next === 'choose') setConnectOpen(true);
            else void loadSyncEngine().then((m) => m.ensureLibrarySyncEngine().start());
          }
        });
    }
    return () => {
      live = false;
    };
  }, [services]);
  const run = async (action: (engine: LibrarySyncEngine) => unknown | Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action((await loadSyncEngine()).ensureLibrarySyncEngine());
      refresh((n) => n + 1);
    } catch {
      setError('동기화를 처리하지 못했어요. 잠시 뒤 다시 해 주세요');
    } finally {
      setBusy(false);
    }
  };
  const login = async (provider: 'google' | 'kakao' | 'naver') => {
    if (!services) return;
    setBusy(true);
    try {
      if (provider === 'google' && services.auth)
        await handleLogin(
          await googleLogin(
            services.api,
            services.auth,
            localStorage,
            deviceLabel(navigator.userAgent),
          ),
        );
      else if (provider !== 'google') await startSocialLogin(provider, services.config);
    } catch {
      setError('로그인을 시작하지 못했어요. 브라우저 저장소를 확인해 주세요');
    } finally {
      setBusy(false);
    }
  };
  const connected = !!session && !!meta.userId;
  const phase = meta.pendingChoice ? 'pending-choice' : status.phase;
  const loginButtons = (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
      {server?.enabled &&
        services &&
        (['google', 'kakao', 'naver'] as const).map(
          (p) =>
            (p === 'google' ? services.config.firebase : services.config[p]) &&
            server.providers[p] && (
              <Button
                key={p}
                variant="outlined"
                disabled={busy}
                sx={{ minHeight: 44 }}
                onClick={() => {
                  void login(p);
                }}
              >
                {p === 'google' ? 'Google' : p === 'kakao' ? '카카오' : '네이버'}로 로그인
              </Button>
            ),
        )}
    </Box>
  );
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      {!connected && (
        <>
          {SYNC_DESCRIPTION.map((text) => (
            <Typography key={text} variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
              {text}
            </Typography>
          ))}
          <Button
            variant="outlined"
            disabled={backup.busy}
            onClick={() => {
              void backup.save();
            }}
            sx={{ minHeight: 44, justifySelf: 'start' }}
          >
            백업 먼저 받기
          </Button>
          {loginButtons}
          {services?.config.firebase && /KAKAOTALK/i.test(navigator.userAgent) && (
            <Typography variant="body2">
              카카오톡 안에서는 Google 로그인이 막혀요. 카카오·네이버로 로그인하거나 다른
              브라우저에서 여세요
            </Typography>
          )}
          {server && !server.enabled && <Typography>지금은 동기화를 쓸 수 없어요</Typography>}
        </>
      )}
      {(connected || status.phase === 'auth' || status.phase === 'not-allowed') && (
        <>
          <Typography fontWeight={700} role="status">
            {syncPhaseText(phase)}
          </Typography>
          {meta.accountLabel && (
            <Typography>
              {meta.accountLabel} ·{' '}
              {meta.provider === 'google'
                ? 'Google'
                : meta.provider === 'kakao'
                  ? '카카오'
                  : '네이버'}
            </Typography>
          )}
          {phase === 'local' && (
            <Typography>
              올리지 않은 변경 {status.dirty}개{status.offline ? ' · 오프라인' : ''}
            </Typography>
          )}
          {phase === 'syncing' && (
            <Typography>
              {status.progress?.step === 'push'
                ? `올리는 중 ${status.progress.done}/${status.progress.total}`
                : '받는 중'}
            </Typography>
          )}
          {phase === 'synced' && status.lastSyncAt && (
            <Typography>
              마지막 동기화 {new Date(status.lastSyncAt).toLocaleTimeString('ko-KR')}
            </Typography>
          )}
          {phase === 'conflict' && (
            <Typography>
              충돌 {status.conflicts}건 · 넣지 못한 항목 {status.held}개 · 올리지 못한 항목{' '}
              {status.rejected}개
            </Typography>
          )}
          {status.message && <Typography role="alert">{status.message}</Typography>}
          {connected && (
            <>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                <Button
                  disabled={busy || phase === 'syncing' || meta.pendingChoice}
                  onClick={() => {
                    void run((e) => e.runNow('manual'));
                  }}
                  sx={{ minHeight: 44 }}
                >
                  지금 동기화
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    void run((e) => (meta.enabled ? e.disable() : e.enable()));
                  }}
                  sx={{ minHeight: 44 }}
                >
                  {meta.enabled ? '동기화 끄기' : '다시 켜기'}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    void run((e) => e.disconnect());
                  }}
                  sx={{ minHeight: 44 }}
                >
                  연결 해제
                </Button>
                {meta.pendingChoice && (
                  <Button onClick={() => setConnectOpen(true)} sx={{ minHeight: 44 }}>
                    연결 방식 고르기
                  </Button>
                )}
                {status.conflicts + status.held + status.rejected > 0 && (
                  <Button onClick={() => setConflictsOpen(true)} sx={{ minHeight: 44 }}>
                    확인
                  </Button>
                )}
              </Box>
              {meta.skipped.length > 0 && (
                <Box>
                  <Typography>
                    건너뛴 항목 {meta.skipped.length}개는 이 기기에서만 바뀝니다
                  </Typography>
                  <Button
                    disabled={busy || phase === 'syncing'}
                    onClick={() => {
                      void run((e) => e.unskipAll());
                    }}
                    sx={{ minHeight: 44 }}
                  >
                    건너뛰기 모두 풀기
                  </Button>
                </Box>
              )}
              <SyncDevices />
              <Button
                color="error"
                onClick={() => setDeleteOpen(true)}
                sx={{ minHeight: 44, justifySelf: 'start' }}
              >
                서버 자료 모두 지우기
              </Button>
            </>
          )}
        </>
      )}
      {loginOutcome && !loginOutcome.ok && (
        <Alert severity="warning">
          {loginOutcome.reason === 'not-allowed' ? (
            <>
              <Typography>이 계정은 아직 동기화를 쓸 수 없어요</Typography>
              <Typography>{loginOutcome.account ?? loginOutcome.email}</Typography>
              <Button
                onClick={() => {
                  void navigator.clipboard.writeText(
                    loginOutcome.account ?? loginOutcome.email ?? '',
                  );
                }}
              >
                복사
              </Button>
              <Typography>관리자에게 이 값을 알려 주세요</Typography>
            </>
          ) : (
            '잠시 뒤 다시 로그인해 주세요'
          )}
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      <SyncConnectDialog
        open={connectOpen}
        onClose={() => {
          setConnectOpen(false);
          refresh((n) => n + 1);
        }}
      />
      <SyncConflictsDialog open={conflictsOpen} onClose={() => setConflictsOpen(false)} />
      <SyncDeleteDialog
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          refresh((n) => n + 1);
        }}
      />
    </Box>
  );
}
