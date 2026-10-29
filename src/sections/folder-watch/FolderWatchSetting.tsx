import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useAtomValue, useSetAtom } from 'jotai';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { formatLocalDateTime } from 'src/domain/backup/summary';
import { loadFolderWatch } from 'src/services/folder-watch/boot';
import { liveLinkIds } from 'src/services/folder-watch/state';
import { folderWatchAtom, setFolderWatchEnabledAtom } from 'src/stores/folder-watch';
import { libraryAtom } from 'src/stores/library-state';
export function FolderWatchSetting() {
  const state = useAtomValue(folderWatchAtom);
  const setEnabled = useSetAtom(setFolderWatchEnabledAtom);
  const library = useAtomValue(libraryAtom);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <FormControlLabel
        label="네이버 폴더 변경 알림"
        control={<Switch checked={state.enabled} onChange={(_, checked) => setEnabled(checked)} />}
      />
      <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
        앱을 열 때 하루 한 번, 가져온 네이버 폴더에 새로 저장한 곳이 있는지 확인해요
      </Typography>
      {liveLinkIds(library).length > 0 && (
        <Box>
          <Button
            variant="outlined"
            disabled={busy}
            sx={{ minHeight: 44 }}
            onClick={() => {
              setBusy(true);
              void loadFolderWatch()
                .then((m) =>
                  m.startFolderWatch({
                    navigate: (p) => {
                      void navigate(p);
                    },
                    manual: true,
                  }),
                )
                .catch(() => {})
                .finally(() => setBusy(false));
            }}
          >
            지금 확인
          </Button>
        </Box>
      )}
      {state.lastRunAt !== null && (
        <Typography variant="body2">{`마지막 확인 ${formatLocalDateTime(new Date(state.lastRunAt).toISOString()).slice(5)}`}</Typography>
      )}
    </Box>
  );
}
