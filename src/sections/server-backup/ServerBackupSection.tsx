import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { Effect } from 'effect';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { BACKUP_READ_MESSAGES } from 'src/domain/backup/read-backup';
import { countsText, libraryCounts } from 'src/domain/backup/summary';
import { startEffect } from 'src/lib/effect/runtime';
import { RestoreDialogHost } from 'src/sections/backup/RestoreDialogHost';
import type { RemoteRestoreSource } from 'src/sections/backup/RestoreDialog';
import { LibraryStore } from 'src/services/library-store';
import { readBootFlag } from 'src/services/library-sync/boot';
import { deviceLabel } from 'src/services/library-sync/login';
import { getSharedSyncApi, getSharedSyncStorage } from 'src/services/library-sync/shared-api';
import {
  readSession,
  readSyncMeta,
  SYNC_META_KEY,
  SYNC_SESSION_KEY,
} from 'src/services/library-sync/storage';
import { syncStatusAtom } from 'src/stores/sync-status';
import {
  createBackupApi,
  uploadBody,
  type BackupFailure,
  type ServerBackupMeta,
} from 'src/services/server-backup/api';
import { loadAutoBackup } from 'src/services/server-backup/boot';
import { buildSnapshot, readSnapshotData } from 'src/services/server-backup/snapshot';
import {
  readServerBackupLocal,
  writeServerBackupLocal,
  SERVER_BACKUP_EVENT,
} from 'src/services/server-backup/storage';
import { prefsAtom } from 'src/stores/prefs-state';
import { ServerBackupConfirmDialog } from './ServerBackupConfirmDialog';
import * as copy from './server-backup-copy';
const readLibrary = Effect.gen(function* () {
  return yield* (yield* LibraryStore).snapshot;
});
export function ServerBackupSection() {
  const storage = getSharedSyncStorage();
  const session = readSession(storage);
  const sessionKey = session?.sessionId ?? null;
  useAtomValue(syncStatusAtom);
  const [, sessionChanged] = useState(0);
  const api = useMemo(() => {
    const sync = getSharedSyncApi();
    return sync ? createBackupApi(sync) : null;
  }, []);
  const prefs = useAtomValue(prefsAtom);
  const [meta, setMeta] = useState<ServerBackupMeta | null>(null);
  const [writable, setWritable] = useState(false);
  const [loading, setLoading] = useState(session !== null);
  const [failure, setFailure] = useState<BackupFailure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [local, setLocal] = useState(() => readServerBackupLocal(storage));
  const [restore, setRestore] = useState<ServerBackupMeta | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    label: string;
    run(): Promise<void>;
  } | null>(null);
  const signedIn = session !== null && api !== null;
  const refreshRun = useRef(0);
  const restoreOwner = useRef<string | null>(null);
  const sameOwner = () => (readSession(storage)?.sessionId ?? null) === sessionKey;
  const syncOn = readBootFlag(storage);
  const refresh = useCallback(async () => {
    if (!api) return;
    const run = ++refreshRun.current;
    const current = () =>
      run === refreshRun.current && (readSession(storage)?.sessionId ?? null) === sessionKey;
    setLoading(true);
    setFailure(null);
    try {
      const result = await api.meta();
      if (!current()) return;
      if (result.ok) {
        setMeta(result.data.backup);
        setWritable(result.data.writable);
      } else setFailure(result.reason);
    } catch {
      if (current()) setFailure('server');
    } finally {
      if (current()) setLoading(false);
    }
  }, [api, storage, sessionKey]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setMeta(null);
      setWritable(false);
      setFailure(null);
      setError(null);
      setRestore(null);
      setConfirm(null);
      if (signedIn) void refresh();
      else setLoading(false);
    });
    return () => {
      active = false;
      refreshRun.current += 1;
    };
  }, [signedIn, refresh]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key === SYNC_META_KEY || event.key === SYNC_SESSION_KEY)
        sessionChanged((n) => n + 1);
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  useEffect(() => {
    const read = () => {
      const next = readServerBackupLocal(storage);
      setLocal(next);
      if (next.last?.outcome === 'uploaded') void refresh();
    };
    window.addEventListener(SERVER_BACKUP_EVENT, read);
    return () => window.removeEventListener(SERVER_BACKUP_EVENT, read);
  }, [storage, refresh]);
  const perform = async (run: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch {
      setError(copy.failureText('server', 'write'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const create = () =>
    perform(async () => {
      let snapshot;
      try {
        snapshot = await startEffect(readLibrary);
      } catch {
        setError(copy.failureText('library', 'write'));
        return;
      }
      if (!sameOwner()) return;
      const upload = async (confirmed = false) => {
        if (!api || !sameOwner()) return;
        const built = await buildSnapshot({
          rawLibrary: snapshot.raw,
          library: snapshot.library,
          prefs,
          now: new Date(),
        });
        if (!sameOwner()) return;
        if (!built.ok) {
          setError(copy.failureText(built.reason, 'write'));
          return;
        }
        const latestConfirm = copy.overwriteConfirmText(
          meta,
          libraryCounts(snapshot.library),
          readBootFlag(storage),
          new Date(),
        );
        if (!confirmed && latestConfirm) {
          setConfirm({
            title: '서버 백업 바꾸기',
            body: latestConfirm,
            label: '바꾸기',
            run: () => upload(true),
          });
          return;
        }
        const result = await api.upload(
          uploadBody(
            built.snapshot,
            {
              deviceId: readSyncMeta(storage).deviceId,
              deviceLabel: deviceLabel(navigator.userAgent),
            },
            'manual',
          ),
        );
        if (!sameOwner()) return;
        if (!result.ok) {
          setError(copy.failureText(result.reason, 'write'));
          return;
        }
        setMeta(result.data.backup);
        toast(`서버 백업을 만들었어요 (${countsText(result.data.backup.counts)})`);
        const { autoBackupInterval } = await loadAutoBackup();
        if (!sameOwner()) return;
        writeServerBackupLocal(storage, {
          ...readServerBackupLocal(storage),
          nextCheckAt: Date.now() + autoBackupInterval(),
        });
      };
      const body = copy.overwriteConfirmText(
        meta,
        libraryCounts(snapshot.library),
        readBootFlag(storage),
        new Date(),
      );
      if (body)
        setConfirm({ title: '서버 백업 바꾸기', body, label: '바꾸기', run: () => upload(true) });
      else await upload();
    });
  const remove = () =>
    setConfirm({
      title: '서버 백업 지우기',
      body:
        '서버 백업을 지울까요? 이 기기 보관함과 백업 파일은 그대로예요.' +
        (local.auto ? ' 자동 백업이 켜져 있어 다음에 다시 만들어요.' : ''),
      label: '지우기',
      run: async () => {
        if (!api || !sameOwner()) return;
        const result = await api.remove();
        if (!sameOwner()) return;
        if (!result.ok) {
          setError(copy.failureText(result.reason, 'delete'));
          return;
        }
        setMeta(null);
        toast('서버 백업을 지웠어요');
      },
    });
  const remote: RemoteRestoreSource = {
    title: copy.RESTORE_TITLE,
    loadingText: copy.RESTORE_LOADING,
    syncNote: syncOn,
    load: async () => {
      if (!sameOwner() || restoreOwner.current !== sessionKey)
        return { ok: false, message: copy.failureText('auth', 'restore') };
      if (!api || !restore) return { ok: false, message: copy.failureText('not-found', 'restore') };
      const result = await api.download(restore.id);
      if (!sameOwner()) return { ok: false, message: copy.failureText('auth', 'restore') };
      if (!result.ok) {
        if (result.reason === 'not-found') setMeta(null);
        return { ok: false, message: copy.failureText(result.reason, 'restore') };
      }
      const read = await readSnapshotData(result.data.data);
      if (!sameOwner()) return { ok: false, message: copy.failureText('auth', 'restore') };
      return read.ok
        ? { ok: true, backup: read.backup, header: copy.restoreHeader(restore) }
        : { ok: false, message: BACKUP_READ_MESSAGES[read.error] };
    },
  };
  const login = (
    <Button component={Link} to="/settings#sync" sx={{ minHeight: 44 }}>
      동기화에서 로그인
    </Button>
  );
  return (
    <Box
      component="section"
      id="server-backup"
      aria-label={copy.SERVER_BACKUP_TITLE}
      sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      <Typography component="h3" sx={{ fontSize: 14, fontWeight: 700 }}>
        {copy.SERVER_BACKUP_TITLE}
      </Typography>
      {!signedIn ? (
        <>
          <Typography variant="body2">{copy.SIGNED_OUT}</Typography>
          {login}
        </>
      ) : loading ? (
        <Typography role="status" variant="body2">
          {copy.LOADING}
        </Typography>
      ) : failure ? (
        <>
          <Typography role="alert" variant="body2">
            {copy.failureText(failure, 'read')}
          </Typography>
          {failure === 'auth'
            ? login
            : failure !== 'not-allowed' && (
                <Button onClick={() => void refresh()} sx={{ minHeight: 44 }}>
                  다시 시도
                </Button>
              )}
        </>
      ) : (
        <>
          <Typography variant="body2">{copy.metaLine(meta, new Date())}</Typography>
          {!writable && <Typography variant="body2">{copy.NOT_WRITABLE}</Typography>}
          {busy && (
            <Typography role="status" variant="body2">
              {copy.CREATING}
            </Typography>
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Button
              variant="contained"
              disabled={!writable || busy}
              onClick={() => void create()}
              sx={{ minHeight: 44 }}
            >
              서버 백업 지금 만들기
            </Button>
            <Button
              variant="outlined"
              disabled={meta === null || busy}
              onClick={() => {
                restoreOwner.current = sessionKey;
                setRestore(meta);
              }}
              sx={{ minHeight: 44 }}
            >
              {copy.RESTORE_TITLE}
            </Button>
            {meta && (
              <Button disabled={busy} onClick={remove} sx={{ minHeight: 44 }}>
                서버 백업 지우기
              </Button>
            )}
          </Box>
        </>
      )}
      {error && (
        <Typography role="alert" variant="body2" color="error">
          {error}
        </Typography>
      )}
      <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
        {copy.NOTE}
      </Typography>
      {signedIn && (
        <>
          <FormControlLabel
            label={copy.AUTO_LABEL}
            control={
              <Switch
                checked={syncOn && local.auto}
                disabled={!syncOn || busy}
                onChange={(_, auto) => {
                  writeServerBackupLocal(storage, {
                    ...local,
                    auto,
                    userId: readSyncMeta(storage).userId,
                  });
                  if (auto)
                    void loadAutoBackup()
                      .then((m) => m.startAutoBackup())
                      .catch(() => {});
                }}
              />
            }
          />
          <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
            {copy.AUTO_HELP}
          </Typography>
          {!syncOn && <Typography variant="body2">{copy.AUTO_NEEDS_SYNC}</Typography>}
          {local.last && (
            <Typography variant="body2">{copy.autoOutcomeText(local.last)}</Typography>
          )}
        </>
      )}
      <ServerBackupConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        body={confirm?.body ?? ''}
        confirmLabel={confirm?.label ?? ''}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm)
            void perform(async () => {
              await confirm.run();
              setConfirm(null);
            });
        }}
      />
      <RestoreDialogHost
        open={restore !== null}
        onClose={() => {
          setRestore(null);
          void refresh();
        }}
        mode="normal"
        remote={remote}
      />
    </Box>
  );
}
