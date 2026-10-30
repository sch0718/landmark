import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Box from '@mui/material/Box';
import { loadSyncEngine, readBootFlag } from 'src/services/library-sync/boot';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { Effect } from 'effect';
import { isEqual } from 'es-toolkit';
import { useAtomValue, useStore } from 'jotai';
import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from 'react';
import { toast } from 'sonner';
import {
  BACKUP_READ_MESSAGES,
  readBackupFile,
  type ReadBackup,
} from 'src/domain/backup/read-backup';
import {
  countsText,
  formatLocalDateTime,
  hasLiveContent,
  libraryCounts,
} from 'src/domain/backup/summary';
import { startEffect } from 'src/lib/effect/runtime';
import { useBackupFile } from 'src/sections/backup/use-backup-file';
import { PreviousNotKept, StorageQuotaExceeded } from 'src/services/errors';
import { LibraryStore } from 'src/services/library-store';
import { useRestoreActions } from 'src/stores/backup-state';
import { libraryAtom } from 'src/stores/library-state';
import { syncStatusAtom, type SyncStatus } from 'src/stores/sync-status';

export const REMOTE_PREVIOUS_NOTE =
  "지금 보관함은 이 기기에 '되살리기 전 보관함'으로도 남아요. 설정 › 백업 › 되살리기 전으로 되돌리기로 돌아갈 수 있어요.";
export const REMOTE_SYNC_NOTE = '이 백업 뒤에 만든 장소·여행은 동기화로 다시 들어와요.';
export const FILE_COPY_FAILED =
  '지금 보관함을 파일로 받지 못했어요. 체크를 풀고 바꾸거나 다시 해 주세요';

const TITLE = '백업에서 되살리기';
const PICK_HELP = 'Landmark 백업 파일(.json)을 고르세요. 손상 화면에서 받은 옛 백업 파일도 돼요.';
const READING = '읽는 중…';
const LEGACY_HEADER = '만든 날짜를 모르는 옛 백업 파일';
const REPLACE_WARNING = '지금 보관함은 지워지고 이 백업 내용으로 바뀌어요.';
const PREFS_NOTE = '테마·보기 설정도 백업 때로 돌아가요. 보관함 필터는 풀어요.';
const UNKNOWN_WARNING =
  '이 백업에는 이 버전이 모르는 정보가 있어요. 되살리면 그 정보는 빠져요. 앱을 새로 고친 뒤 되살리는 것이 좋아요.';
const SAME_CONTENT = '지금 보관함과 같은 내용이에요';
const CURRENT_UNREADABLE = '지금 보관함: 읽지 못함';
const DOWNLOAD_CURRENT = '지금 원문 받기';
const CURRENT_NOT_FOUND = '백업할 데이터를 찾지 못했어요';

/** 모드별 "사본을 남기지 못함" 문구(스펙 §2.3·§2.4·§2.7). */
const NOT_KEPT = {
  normal: {
    changed: "그사이 보관함이 바뀌었어요. '지금 보관함 먼저 받기'로 다시 받은 뒤 바꿔 주세요",
    quota:
      "저장 공간이 부족해 지금 보관함을 기기에 남겨 둘 수 없어요. 먼저 '지금 보관함 먼저 받기'로 파일을 받은 뒤 바꿔 주세요",
  },
  corrupt: {
    changed: "그사이 데이터가 바뀌었어요. '지금 원문 받기'로 다시 받아 주세요",
    quota:
      "저장 공간이 부족해 지금 데이터를 남겨 둘 수 없어요. 먼저 '백업 파일 받기'로 받아 주세요",
  },
} as const;
const REPLACE_QUOTA = '저장 공간이 부족해 되살리지 못했어요. 지금 보관함은 그대로예요';
const REPLACE_FAILED = '되살리지 못했어요. 지금 보관함은 그대로예요';
const UNDO_MS = 10_000;

type Mode = 'normal' | 'corrupt';

export type RemoteRestoreSource = {
  title: string;
  loadingText: string;
  load(): Promise<
    { ok: true; backup: ReadBackup; header: string } | { ok: false; message: string }
  >;
  syncNote: boolean;
};

export type RestoreDialogProps = {
  remote?: RemoteRestoreSource;
  open: boolean;
  onClose(): void;
  mode: Mode;
  /** 손상 화면의 `백업 파일 받기`가 받은 원문. 있으면 requirePrevious 거짓이고 replace의 savedText로 넘긴다. */
  savedText?: string;
  /** 손상 화면에서 `지금 원문 받기`: 지금 원문을 받아 그 원문을 돌려준다(받지 못하면 `null`). */
  onDownloadCurrent?(): Promise<string | null>;
  onRestored?(): void;
};

type Step = { kind: 'pick' } | { kind: 'reading' } | { kind: 'preview'; backup: ReadBackup };

type ReplaceError = { message: string; downloadCurrent: boolean };

/** 바꾸기 실패를 모드별 문구로 바꾼다. */
function replaceError(mode: Mode, error: unknown): ReplaceError {
  if (error instanceof PreviousNotKept) {
    const changed = error.changedSinceSaved;
    return {
      message: changed ? NOT_KEPT[mode].changed : NOT_KEPT[mode].quota,
      downloadCurrent: changed && mode === 'corrupt',
    };
  }
  if (error instanceof StorageQuotaExceeded) {
    return { message: REPLACE_QUOTA, downloadCurrent: false };
  }
  return { message: REPLACE_FAILED, downloadCurrent: false };
}

/** 받지 못한 변경이 없는 완료 상태만 원격 되살리기를 허용한다. */
function syncRestoreMessage(status: SyncStatus): string | null {
  if (status.phase === 'synced' || (status.phase === 'conflict' && status.held === 0)) return null;
  if (status.phase === 'syncing') return '동기화가 끝난 뒤 되살릴 수 있어요';
  switch (status.phase) {
    case 'auth':
      return '설정 › 동기화에서 다시 로그인해 주세요';
    case 'not-allowed':
      return '이 계정은 동기화를 사용할 수 없어요';
    case 'unavailable':
      return '서버 동기화를 사용할 수 없어요. 잠시 뒤 다시 시도해 주세요';
    case 'error':
      return status.message ?? '동기화 오류를 해결한 뒤 다시 시도해 주세요';
    case 'pending-choice':
      return '설정 › 동기화에서 연결 방식을 먼저 골라 주세요';
    case 'off':
      return '설정 › 동기화에서 이 기기의 동기화를 확인해 주세요';
    default:
      if (status.held > 0) return '받지 못한 서버 변경이 있어요. 설정 › 동기화를 확인해 주세요';
      if (status.offline) return '인터넷에 연결한 뒤 다시 시도해 주세요';
      return '동기화가 끝난 뒤 되살릴 수 있어요';
  }
}

/**
 * 연 때의 저장소 원문(키가 없으면 `null`). 빈 보관함이라 사본 없이 바꾸려 할 때 `savedText`로 넘긴다(스펙 §5).
 * 읽지 못하면(다른 탭이 망가뜨림) `null`을 돌려준다: 그때 저장소에는 원문이 있으므로 `null`과 달라 사본(손상
 * 백업)이 필수가 된다.
 */
const readOpenText = Effect.gen(function* () {
  return (yield* (yield* LibraryStore).snapshot).text;
}).pipe(Effect.orElseSucceed(() => null));

/**
 * `백업에서 되살리기` 대화상자(스펙 §2.3, 손상 화면은 §2.4): 파일 고르기 → 미리보기 → 바꾸기.
 * 열 때마다 단계·오류·받기 표시를 초기화하고, 열고 닫을 때와 파일을 고를 때마다 실행 번호를 올려
 * 그 전에 시작한 읽기·바꾸기의 결과는 버린다. 바꾸는 동안에는 닫히지 않는다.
 *
 * 사본 규칙(스펙 §5): 일반 모드는 지금 보관함에 살아 있는 항목이 있고 이 대화상자에서 아직 받지 않았으면
 * 사본이 필수다. 받았으면 그때 담은 원문을, 받지 않았고 사본이 필수가 아니면 연 때의 원문을 `savedText`로
 * 넘겨, 그사이 보관함이 바뀌었으면 저장소가 사본을 요구하게 한다. 손상 모드는 받은 원문(`savedText`)이
 * 있을 때만 사본(손상 백업) 없이 바꿀 수 있다.
 */
export function RestoreDialog({
  open,
  onClose,
  mode,
  savedText: savedTextProp,
  onDownloadCurrent,
  onRestored,
  remote,
}: RestoreDialogProps) {
  const library = useAtomValue(libraryAtom);
  const syncStatus = useAtomValue(syncStatusAtom);
  const store = useStore();
  const syncMessage = remote && readBootFlag() ? syncRestoreMessage(syncStatus) : null;
  const syncBlocked = syncMessage !== null;
  const canReplace = () =>
    !remote || !readBootFlag() || syncRestoreMessage(store.get(syncStatusAtom)) === null;
  const { replace, undo } = useRestoreActions();
  const backupFile = useBackupFile();
  const remoteRef = useRef(remote);
  useLayoutEffect(() => {
    remoteRef.current = remote;
  });
  const [downloadBefore, setDownloadBefore] = useState(true);
  const [remoteHeader, setRemoteHeader] = useState<string | null>(null);
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLButtonElement>(null);
  const replaceRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);

  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [readError, setReadError] = useState<string | null>(null);
  const [error, setError] = useState<ReplaceError | null>(null);
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState(false);
  /** 이 대화상자에서 `지금 보관함 먼저 받기`가 성공했으면 그 파일에 담은 원문. */
  const [downloaded, setDownloaded] = useState<{ savedText: string | null } | null>(null);
  /** 손상 모드의 받은 원문. `props.savedText`로 채우고, 그 값이 바뀌거나 `지금 원문 받기`가 받으면 바꾼다. */
  const [corruptSavedText, setCorruptSavedText] = useState(savedTextProp);
  const [seededFrom, setSeededFrom] = useState(savedTextProp);
  // 지금 열린 창의 실행 번호. 작업은 시작할 때 번호를 기억하고, 끝났을 때 바뀌었으면 결과를 버린다.
  const runIdRef = useRef(0);
  const busyRef = useRef(false);
  const receivingRef = useRef(false);
  // 연 때 읽은 저장소 원문(일반 모드).
  const openTextRef = useRef<Promise<string | null>>(Promise.resolve(null));

  if (savedTextProp !== seededFrom) {
    setSeededFrom(savedTextProp);
    setCorruptSavedText(savedTextProp);
  }

  // 열릴 때 초기화한다(렌더 중 상태 갱신).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStep({ kind: 'pick' });
      setReadError(null);
      setError(null);
      setBusy(false);
      setReceiving(false);
      setDownloaded(null);
      setDownloadBefore(true);
      setRemoteHeader(null);
      setCorruptSavedText(savedTextProp);
    }
  }

  const loadRemote = useCallback(async () => {
    const source = remoteRef.current;
    if (!source) return;
    const runId = ++runIdRef.current;
    setStep({ kind: 'reading' });
    setReadError(null);
    try {
      const result = await source.load();
      if (runIdRef.current !== runId) return;
      if (result.ok) {
        setRemoteHeader(result.header);
        setStep({ kind: 'preview', backup: result.backup });
      } else {
        setStep({ kind: 'pick' });
        setReadError(result.message);
      }
    } catch {
      if (runIdRef.current === runId) {
        setStep({ kind: 'pick' });
        setReadError('서버 백업을 받지 못했어요');
      }
    }
  }, []);

  // 열고 닫을 때 앞 작업을 무효로 한다. 열 때는 저장소 원문을 읽어 둔다(`파일 고르기` 포커스는 `autoFocus`).
  useLayoutEffect(() => {
    runIdRef.current += 1;
    busyRef.current = false;
    receivingRef.current = false;
    if (!open) return;
    if (mode === 'normal') openTextRef.current = startEffect(readOpenText);
    if (remoteRef.current) void loadRemote();
    return () => {
      runIdRef.current += 1;
    };
  }, [open, mode, loadRemote]);

  // 단계가 바뀐 그림이 그려진 뒤 그 단계의 첫 조작 요소로 포커스한다(꺼져 있으면 `fallback`).
  const focusLater = (
    ref: RefObject<HTMLButtonElement | null>,
    fallback?: RefObject<HTMLButtonElement | null>,
  ) =>
    requestAnimationFrame(() => {
      const target = ref.current?.disabled === false ? ref.current : fallback?.current;
      target?.focus();
    });

  // 상태를 바꾼 직후 요청하면, 그 상태가 그려진 같은 커밋에서(레이아웃 효과) 포커스를 옮긴다. 타이머 없이 정해진 순서다.
  const pendingFocusRef = useRef<{
    ref: RefObject<HTMLButtonElement | null>;
    fallback: RefObject<HTMLButtonElement | null>;
  } | null>(null);
  const focusAfterCommit = (
    ref: RefObject<HTMLButtonElement | null>,
    fallback: RefObject<HTMLButtonElement | null>,
  ) => {
    pendingFocusRef.current = { ref, fallback };
  };
  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (pending === null) return;
    pendingFocusRef.current = null;
    const target =
      pending.ref.current?.disabled === false ? pending.ref.current : pending.fallback.current;
    target?.focus();
  });

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // 같은 파일을 다시 골라도 `change`가 오도록 비운다.
    event.target.value = '';
    if (file === undefined) return;
    runIdRef.current += 1;
    const runId = runIdRef.current;
    setStep({ kind: 'reading' });
    setReadError(null);
    setError(null);
    const result = await readBackupFile(file);
    if (runIdRef.current !== runId) return;
    if (!result.ok) {
      setStep({ kind: 'pick' });
      setReadError(BACKUP_READ_MESSAGES[result.error]);
      focusLater(pickRef);
      return;
    }
    setStep({ kind: 'preview', backup: result.backup });
    focusLater(replaceRef, cancelRef);
  };

  const live = mode === 'normal' && hasLiveContent(library);

  const doReplace = async (backup: ReadBackup) => {
    if (busyRef.current || !canReplace()) return;
    const savedPromise =
      remote && live && downloadBefore && downloaded === null ? backupFile.save() : null;
    const runId = runIdRef.current;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    let outcome;
    try {
      let saved = downloaded;
      if (savedPromise !== null) {
        saved = await savedPromise;
        if (runIdRef.current !== runId) return;
        if (saved === null) {
          setError({ message: FILE_COPY_FAILED, downloadCurrent: false });
          return;
        }
        setDownloaded(saved);
      }
      let options: { requirePrevious: boolean; savedText?: string | null };
      if (mode === 'corrupt') {
        options =
          corruptSavedText === undefined
            ? { requirePrevious: true }
            : { requirePrevious: false, savedText: corruptSavedText };
      } else if (saved !== null) {
        options = { requirePrevious: false, savedText: saved.savedText };
      } else if (live) {
        options = { requirePrevious: true };
      } else {
        options = { requirePrevious: false, savedText: await openTextRef.current };
      }
      if (!canReplace()) return;
      const apply = () => replace(remote ? { ...backup, exportedAt: null } : backup, options);
      if (remote && readBootFlag()) {
        receivingRef.current = true;
        setReceiving(true);
        const engine = (await loadSyncEngine()).ensureLibrarySyncEngine();
        outcome = await engine.runThen('manual', async (status) => {
          if (runIdRef.current !== runId) return;
          if (syncRestoreMessage(status) !== null) {
            if (status.phase === 'auth' && store.get(syncStatusAtom).phase !== 'auth')
              setError({
                message: '동기화 연결이 바뀌어 되살리지 않았어요. 다시 시도해 주세요',
                downloadCurrent: false,
              });
            return;
          }
          receivingRef.current = false;
          setReceiving(false);
          return apply();
        });
      } else outcome = await apply();
    } catch {
      if (runIdRef.current !== runId) return;
      setError({
        message: '최신 변경을 받지 못했어요. 설정 › 동기화를 확인해 주세요',
        downloadCurrent: false,
      });
      return;
    } finally {
      if (runIdRef.current === runId) {
        busyRef.current = false;
        receivingRef.current = false;
        setBusy(false);
        setReceiving(false);
      }
    }
    if (runIdRef.current !== runId || !outcome) return;
    if (!outcome.ok) {
      const failure = replaceError(mode, outcome.error);
      setError(failure);
      // 눌렀던 버튼은 바꾸는 동안 꺼져 포커스를 잃으므로, 보이는 조작 요소로 옮긴다.
      if (failure.downloadCurrent && onDownloadCurrent !== undefined) {
        focusAfterCommit(currentRef, replaceRef);
      } else {
        focusAfterCommit(replaceRef, cancelRef);
      }
      return;
    }
    const message = `백업에서 되살렸어요 (${countsText(outcome.counts)})`;
    if (outcome.previousKept) {
      toast(message, {
        duration: UNDO_MS,
        action: { label: '되돌리기', onClick: () => void undo() },
      });
    } else {
      toast(message);
    }
    onClose();
    onRestored?.();
  };

  const downloadFirst = async () => {
    const runId = runIdRef.current;
    const saved = await backupFile.save();
    if (saved === null || runIdRef.current !== runId) return;
    setDownloaded(saved);
    setError(null);
  };

  const downloadCurrent = async () => {
    if (onDownloadCurrent === undefined || busyRef.current) return;
    const runId = runIdRef.current;
    busyRef.current = true;
    setBusy(true);
    let focus: 'replace' | 'current' | null = null;
    try {
      const text = await onDownloadCurrent();
      if (runIdRef.current !== runId) return;
      if (text !== null) {
        setCorruptSavedText(text);
        setError(null);
        focus = 'replace';
      } else {
        // 모달 뒤의 화면이 아니라 이 창의 알림으로 알린다. 다시 눌러 볼 수 있게 버튼은 남긴다.
        setError({ message: CURRENT_NOT_FOUND, downloadCurrent: true });
        focus = 'current';
      }
    } catch (e) {
      // 받지 못했으면 문구를 그대로 두어 다시 누를 수 있게 한다.
      console.error(e);
    } finally {
      if (runIdRef.current === runId) {
        busyRef.current = false;
        setBusy(false);
      }
    }
    // 눌렀던 버튼은 받는 동안 꺼져 포커스를 잃는다. 받았으면 다음 조작(바꾸기)으로, 못 받았으면 그 버튼으로.
    if (focus === 'replace') focusAfterCommit(replaceRef, cancelRef);
    if (focus === 'current') focusAfterCommit(currentRef, cancelRef);
  };

  const preview = step.kind === 'preview' ? step.backup : null;
  // 보관함이 크면 비교가 무거우므로 미리보기나 보관함이 바뀔 때만 다시 비교한다.
  const same = useMemo(
    () => preview !== null && mode === 'normal' && isEqual(preview.library, library),
    [preview, mode, library],
  );
  const working = busy || backupFile.busy;
  const replaceDisabled = working || same || syncBlocked;

  const close = () => {
    if (busyRef.current && !receivingRef.current) return;
    runIdRef.current += 1;
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} aria-labelledby={titleId} fullWidth maxWidth="xs">
      <DialogTitle id={titleId}>{remote?.title ?? TITLE}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {preview === null ? (
            <>
              {!remote && (
                <>
                  <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
                    {PICK_HELP}
                  </Typography>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".json,application/json"
                    hidden
                    aria-label="백업 파일 선택"
                    onChange={(event) => void onPick(event)}
                  />
                  <Box>
                    <Button
                      ref={pickRef}
                      autoFocus
                      variant="contained"
                      disabled={step.kind === 'reading'}
                      onClick={() => inputRef.current?.click()}
                      sx={{ minHeight: 44 }}
                    >
                      파일 고르기
                    </Button>
                  </Box>
                </>
              )}
              {remote && readError !== null && (
                <Button onClick={() => void loadRemote()} sx={{ minHeight: 44 }}>
                  다시 시도
                </Button>
              )}
              {step.kind === 'reading' && (
                <Typography
                  role="status"
                  variant="body2"
                  sx={{ color: 'var(--tm-text-secondary)' }}
                >
                  {remote?.loadingText ?? READING}
                </Typography>
              )}
              {readError !== null && (
                <Typography role="alert" variant="body2" color="error">
                  {readError}
                </Typography>
              )}
            </>
          ) : (
            <>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {remoteHeader ??
                  (preview.exportedAt === null
                    ? LEGACY_HEADER
                    : `${formatLocalDateTime(preview.exportedAt)}에 만든 백업`)}
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                <Typography component="li" variant="body2">
                  {`백업 파일: ${countsText(libraryCounts(preview.library))}`}
                </Typography>
                <Typography component="li" variant="body2">
                  {mode === 'corrupt'
                    ? CURRENT_UNREADABLE
                    : `지금 보관함: ${countsText(libraryCounts(library))}`}
                </Typography>
              </Box>
              <Typography role="alert" variant="body2">
                {REPLACE_WARNING}
              </Typography>
              {readBootFlag() && (
                <Typography variant="body2">
                  동기화가 켜져 있어요. 되살린 내용은 다른 기기에도 반영돼요.
                </Typography>
              )}
              {preview.prefs !== null && (
                <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
                  {PREFS_NOTE}
                </Typography>
              )}
              {preview.droppedUnknown && (
                <Typography role="alert" variant="body2">
                  {UNKNOWN_WARNING}
                </Typography>
              )}
              {remote && live && (
                <>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={downloadBefore}
                        disabled={working}
                        onChange={(_, checked) => setDownloadBefore(checked)}
                      />
                    }
                    label="바꾸기 전에 지금 보관함을 파일로 받기"
                  />
                  <Typography variant="body2">{REMOTE_PREVIOUS_NOTE}</Typography>
                  {remote.syncNote && <Typography variant="body2">{REMOTE_SYNC_NOTE}</Typography>}
                </>
              )}
              {(receiving || syncBlocked) && (
                <Typography role="status" variant="body2">
                  {receiving ? '서버의 최신 변경을 먼저 받는 중…' : syncMessage}
                </Typography>
              )}
              {same && (
                <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
                  {SAME_CONTENT}
                </Typography>
              )}
              {backupFile.error !== null && (
                <Typography role="alert" variant="body2" color="error">
                  {backupFile.error}
                </Typography>
              )}
              {error !== null && (
                <Typography role="alert" variant="body2" color="error">
                  {error.message}
                </Typography>
              )}
              {error?.downloadCurrent === true && onDownloadCurrent !== undefined && (
                <Box>
                  <Button
                    ref={currentRef}
                    variant="outlined"
                    disabled={working}
                    onClick={() => void downloadCurrent()}
                    sx={{ minHeight: 44 }}
                  >
                    {DOWNLOAD_CURRENT}
                  </Button>
                </Box>
              )}
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1, '& > :not(style) ~ :not(style)': { ml: 0 } }}>
        <Button
          ref={cancelRef}
          onClick={close}
          disabled={busy && !receiving}
          sx={{ minHeight: 44 }}
        >
          취소
        </Button>
        {preview !== null && live && !remote && (
          <Button
            variant="outlined"
            disabled={working}
            onClick={() => void downloadFirst()}
            sx={{ minHeight: 44 }}
          >
            지금 보관함 먼저 받기
          </Button>
        )}
        {preview !== null && (
          <Button
            ref={replaceRef}
            variant="contained"
            disabled={replaceDisabled}
            onClick={() => void doReplace(preview)}
            sx={{ minHeight: 44 }}
          >
            이 백업으로 바꾸기
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
