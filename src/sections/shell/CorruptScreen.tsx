import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Effect } from 'effect';
import { useState } from 'react';
import { downloadText } from 'src/lib/download-text';
import { startEffect } from 'src/lib/effect/runtime';
import { LibraryCorrupt } from 'src/services/errors';
import { browserStorage } from 'src/services/browser-storage';
import { RestoreDialogHost } from 'src/sections/backup/RestoreDialogHost';
import { LIBRARY_KEY, LibraryStore } from 'src/services/library-store';

/**
 * 내려받을 원문. 백업 키가 있으면 그 원문, 없으면(백업을 못 남겼다) 지금 `LIBRARY_KEY`에
 * 저장된 원문이다. 어느 쪽도 읽지 못하면 `null`.
 */
function readBackupText(backupKey: string | null): string | null {
  try {
    const storage = browserStorage();
    if (storage === undefined) return null;
    return (backupKey === null ? null : storage.getItem(backupKey)) ?? storage.getItem(LIBRARY_KEY);
  } catch {
    return null;
  }
}

/** 지금 `LIBRARY_KEY`에 저장된 원문(손상 사본이 아니라 저장소의 지금 값). 읽지 못하거나 없으면 `null`. */
function readCurrentText(): string | null {
  try {
    return browserStorage()?.getItem(LIBRARY_KEY) ?? null;
  } catch {
    return null;
  }
}

/** 손상 화면이 내려받는 파일 이름. `백업 파일 받기`·`지금 원문 받기`가 같은 규칙을 쓴다. */
const downloadRaw = (text: string) =>
  downloadText(text, `landmark-backup-${new Date().toISOString()}.json`, 'application/json');

const reset = Effect.gen(function* () {
  return yield* (yield* LibraryStore).resetWithBackup;
});

function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'userMessage' in error) {
    if (typeof error.userMessage === 'string') return error.userMessage;
  }
  return '새로 시작하지 못했어요';
}

/**
 * 저장된 보관함 문서를 읽지 못할 때의 전체 화면(스펙 §6.3). 조용히 덮어쓰지 않고, 원문을 내려받게 한 뒤
 * 사용자가 "새로 시작"을 눌러야 빈 문서로 바꾼다(이때도 원문 백업을 먼저 확보한다).
 */
export function CorruptScreen({
  error,
  onRecovered,
}: {
  error: LibraryCorrupt;
  /** 새 문서를 쓴 뒤(또는 다른 탭이 이미 복구했을 때) 부른다. 보관함을 다시 읽는다. */
  onRecovered: () => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  /** `백업 파일 받기`가 내려받은 원문. 되살리기가 사본 없이 바꿔도 되는지 비교하는 기준이다(다시 받으면 새 값). */
  const [savedText, setSavedText] = useState<string | undefined>(undefined);

  const download = () => {
    const text = readBackupText(error.backupKey);
    if (text === null) {
      setMessage('백업할 데이터를 찾지 못했어요');
      return;
    }
    setMessage(null);
    downloadRaw(text);
    setSavedText(text);
  };

  /**
   * `지금 원문 받기`: 손상 사본이 아니라 지금 원문을 받는다. `readBackupText`는 사본을 먼저 읽어, 다른 탭이 원문을
   * 바꾼 뒤에는 다시 받아도 옛 사본만 나오기 때문이다(스펙 §2.4). 받은 원문을 돌려주면 대화상자가 기준으로 삼는다.
   */
  const downloadCurrent = (): Promise<string | null> => {
    const text = readCurrentText();
    if (text === null) {
      setMessage('백업할 데이터를 찾지 못했어요');
      return Promise.resolve(null);
    }
    setMessage(null);
    downloadRaw(text);
    return Promise.resolve(text);
  };

  const startOver = async () => {
    setResetting(true);
    setMessage(null);
    try {
      await startEffect(reset);
      onRecovered();
    } catch (cause) {
      setMessage(messageOf(cause));
      setResetting(false);
    }
  };

  return (
    <Box
      role="alert"
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.5,
        p: 3,
        pt: 'calc(24px + env(safe-area-inset-top, 0px))',
        textAlign: 'center',
        bgcolor: 'var(--tm-bg-base)',
        color: 'var(--tm-text-primary)',
      }}
    >
      <Typography variant="h6" component="h1">
        데이터를 읽지 못했어요
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
        저장된 보관함이 손상됐거나 알 수 없는 형식이에요. 먼저 백업 파일을 받아 두면 나중에 복구를
        시도해 볼 수 있어요.
      </Typography>
      {message !== null && (
        <Typography variant="body2" color="error">
          {message}
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Button variant="outlined" onClick={download} sx={{ minHeight: 44 }}>
          백업 파일 받기
        </Button>
        <Button
          variant="outlined"
          onClick={() => setRestoreOpen(true)}
          disabled={resetting}
          sx={{ minHeight: 44 }}
        >
          백업 파일로 되살리기
        </Button>
        <Button
          variant="contained"
          onClick={() => void startOver()}
          disabled={resetting}
          sx={{ minHeight: 44 }}
        >
          새로 시작
        </Button>
      </Box>
      <RestoreDialogHost
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        mode="corrupt"
        savedText={savedText}
        onDownloadCurrent={downloadCurrent}
        onRestored={onRecovered}
      />
    </Box>
  );
}
