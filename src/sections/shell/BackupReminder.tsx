import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { reminderState, reminderText } from 'src/domain/backup/reminder';
import { useBackupFile } from 'src/sections/backup/use-backup-file';
import { MAIN_ID } from 'src/sections/shell/SkipLink';
import { backupMetaAtom, snoozeReminderAtom } from 'src/stores/backup-state';
import { libraryAtom, persistenceAtom } from 'src/stores/library-state';

/**
 * 백업 알림 띠(스펙 §2.5). 보관함 화면에서 오래 백업하지 않았고 그 뒤로 바뀐 내용이 있을 때만 보인다.
 * 라이브 영역이 아니다(화면 읽기 프로그램이 불쑥 읽지 않는다). `백업 받기`는 공유가 되는 기기에서는 공유 창을,
 * 아니면 파일 받기를 연다. 띠가 사라지면 포커스가 갈 곳을 잃지 않도록 본문(`#main`)으로 옮긴다.
 */
export function BackupReminder() {
  const library = useAtomValue(libraryAtom);
  const persistence = useAtomValue(persistenceAtom);
  const meta = useAtomValue(backupMetaAtom);
  const snooze = useSetAtom(snoozeReminderAtom);
  const { shareable, busy, save, share } = useBackupFile();

  const state = reminderState({ library, meta, persistence, now: new Date().getTime() });
  const shown = state !== null;

  // 이 자리에서 보이던 띠가 사라졌을 때만 포커스를 옮긴다(화면을 떠나 통째로 내려가는 때는 해당 없음).
  const wasShown = useRef(shown);
  useEffect(() => {
    if (wasShown.current && !shown) {
      const active = document.activeElement;
      // 다른 곳에 포커스가 가 있으면 건드리지 않는다.
      if (active === null || active === document.body) {
        document.getElementById(MAIN_ID)?.focus({ preventScroll: true });
      }
    }
    wasShown.current = shown;
  }, [shown]);

  if (state === null) return null;
  return (
    <Box
      component="section"
      aria-label="백업 알림"
      sx={{
        flex: 'none',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 2,
        rowGap: 1,
        px: 2,
        py: 1,
        bgcolor: 'var(--tm-bg-raised)',
        color: 'var(--tm-text-primary)',
        borderBottom: '1px solid var(--tm-border-strong)',
      }}
    >
      <Typography variant="body2" sx={{ flex: '1 1 16rem', minWidth: 0 }}>
        {reminderText(state)}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          variant="contained"
          disabled={busy}
          onClick={() => void (shareable ? share() : save())}
          sx={{ minHeight: 44 }}
        >
          백업 받기
        </Button>
        <Button
          variant="text"
          onClick={() => snooze(new Date().toISOString())}
          sx={{ minHeight: 44, color: 'var(--tm-text-secondary)' }}
        >
          나중에
        </Button>
      </Box>
    </Box>
  );
}
