import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useAtomValue } from 'jotai';
import { formatLocalDateTime } from 'src/domain/backup/summary';
import { useBackupFile } from 'src/sections/backup/use-backup-file';
import { backupMetaAtom } from 'src/stores/backup-state';

const DESCRIPTION =
  '보관함(장소·라벨·여행)은 이 기기의 브라우저에만 저장돼요. 브라우저는 오래 쓰지 않은 사이트의 데이터를 지울 수 있어요(특히 아이폰 사파리). 가끔 백업 파일을 받아 두세요.';

/** 이 기기 시간의 달력 날짜 차이(같은 날이면 0). 서머타임으로 하루가 23·25시간이어도 반올림으로 맞춘다. */
function daysAgo(iso: string, now: Date): number {
  const then = new Date(iso);
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const b = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  return Math.max(0, Math.round((a - b) / 86_400_000));
}

/** `마지막 백업: YYYY.MM.DD HH:mm (N일 전)` / `(오늘)` / `마지막 백업: 없음`. */
function lastBackupText(lastBackupAt: string | null, now: Date): string {
  if (lastBackupAt === null) return '마지막 백업: 없음';
  const days = daysAgo(lastBackupAt, now);
  return `마지막 백업: ${formatLocalDateTime(lastBackupAt)} (${days === 0 ? '오늘' : `${days}일 전`})`;
}

/** 설정의 `백업` 칸. 되살리기 버튼의 동작은 `onRestore`가 채운다. */
export function BackupSection({ onRestore }: { onRestore(): void }) {
  const meta = useAtomValue(backupMetaAtom);
  const { shareable, busy, error, save, share } = useBackupFile();

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
        <Button variant="outlined" onClick={onRestore} sx={{ minHeight: 44 }}>
          백업 파일로 되살리기
        </Button>
      </Box>
    </>
  );
}
