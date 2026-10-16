import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useAtomValue } from 'jotai';
import { useRef, useState } from 'react';
import { calendarDaysAgo, countsText, formatLocalDateTime } from 'src/domain/backup/summary';
import { useBackupFile } from 'src/sections/backup/use-backup-file';
import { backupMetaAtom, usePreviousCopy, useRestoreActions } from 'src/stores/backup-state';

const DESCRIPTION =
  '보관함(장소·라벨·여행)은 이 기기의 브라우저에만 저장돼요. 브라우저는 오래 쓰지 않은 사이트의 데이터를 지울 수 있어요(특히 아이폰 사파리). 가끔 백업 파일을 받아 두세요.';

/** `마지막 백업: YYYY.MM.DD HH:mm (N일 전)` / `(오늘)` / `마지막 백업: 없음`. */
function lastBackupText(lastBackupAt: string | null, now: Date): string {
  if (lastBackupAt === null) return '마지막 백업: 없음';
  const days = calendarDaysAgo(lastBackupAt, now);
  return `마지막 백업: ${formatLocalDateTime(lastBackupAt)} (${days === 0 ? '오늘' : `${days}일 전`})`;
}

/**
 * 설정의 `백업` 칸. 되살리기 버튼의 동작은 `onRestore`가 채운다. 되살리기 전 사본이 있으면 그 요약과
 * `되살리기 전으로 되돌리기`·`지우기`를 보인다(스펙 §2.1). 사본 줄이 사라지면 포커스를 되살리기 버튼으로 옮긴다.
 */
export function BackupSection({ onRestore }: { onRestore(): void }) {
  const meta = useAtomValue(backupMetaAtom);
  const { shareable, busy, error, save, share } = useBackupFile();
  const { info: previous } = usePreviousCopy();
  const { undo, drop } = useRestoreActions();
  const [previousBusy, setPreviousBusy] = useState(false);
  const restoreRef = useRef<HTMLButtonElement>(null);

  const onPrevious = async (action: () => Promise<boolean | void>) => {
    if (previousBusy) return;
    setPreviousBusy(true);
    let done: boolean | void;
    try {
      done = await action();
    } finally {
      setPreviousBusy(false);
    }
    // 사본 줄이 사라졌으면(되돌림·지움) 포커스를 잃지 않게 옮긴다.
    if (done !== false) restoreRef.current?.focus();
  };

  return (
    <>
      <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
        {DESCRIPTION}
      </Typography>
      <Typography variant="body2">{lastBackupText(meta.lastBackupAt, new Date())}</Typography>
      {error !== null && (
        <Typography role="alert" variant="body2" color="error">
          {error}
        </Typography>
      )}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <Button
          variant="contained"
          disabled={busy}
          onClick={() => void save()}
          sx={{ minHeight: 44 }}
        >
          백업 파일 받기
        </Button>
        {shareable && (
          <Button
            variant="outlined"
            disabled={busy}
            onClick={() => void share()}
            sx={{ minHeight: 44 }}
          >
            백업 공유
          </Button>
        )}
        <Button ref={restoreRef} variant="outlined" onClick={onRestore} sx={{ minHeight: 44 }}>
          백업 파일로 되살리기
        </Button>
      </Box>
      {previous !== null && (
        <>
          <Typography variant="body2">
            {`되살리기 전 보관함이 남아 있어요 (${formatLocalDateTime(previous.savedAt)} · ${countsText(previous.counts)})`}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Button
              variant="outlined"
              disabled={previousBusy}
              onClick={() => void onPrevious(undo)}
              sx={{ minHeight: 44 }}
            >
              되살리기 전으로 되돌리기
            </Button>
            <Button
              disabled={previousBusy}
              onClick={() => void onPrevious(drop)}
              sx={{ minHeight: 44 }}
            >
              지우기
            </Button>
          </Box>
        </>
      )}
    </>
  );
}
