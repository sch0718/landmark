import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { Suspense, useId, useState } from 'react';
import { ChunkErrorBoundary } from 'src/components/ChunkErrorBoundary';
import { ChunkErrorNotice } from 'src/components/ChunkErrorNotice';
import { ExportHtmlDialog } from 'src/routes/lazy-routes';
import type { ExportTargets } from 'src/sections/share-export/export-targets';

type Props = { open: boolean; onClose(): void; targets: ExportTargets };

/**
 * 내보내기 대화상자(`ExportHtmlDialog`)를 처음 열 때 받아 그린다. 한 번 열린 뒤에는 닫아도 마운트를 지우지 않고
 * `open`만 바꾼다: 이 대화상자는 `open`이 `false`로 바뀔 때 진행 중인 저장·공유를 무효로 하므로(스펙 §2),
 * 닫을 때 마운트를 지우면 닫은 창의 저장이 이어진다. 파일을 받는 동안은 아무것도 보이지 않고(받으면 바로 열린다),
 * 받지 못하면(새 배포 뒤 옛 파일 없음) 대화상자 안에 새 버전 안내를 보인다.
 */
export function ExportHtmlDialogHost({ open, onClose, targets }: Props) {
  // 렌더 중 상태 갱신으로, 처음 열리는 그 렌더부터 마운트한다.
  const failedTitleId = useId();
  const [everOpened, setEverOpened] = useState(open);
  if (open && !everOpened) setEverOpened(true);
  if (!everOpened) return null;
  return (
    <ChunkErrorBoundary
      fallback={
        <Dialog
          open={open}
          onClose={onClose}
          aria-labelledby={failedTitleId}
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle id={failedTitleId}>내보내기</DialogTitle>
          <DialogContent>
            <ChunkErrorNotice />
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose} sx={{ minHeight: 44 }}>
              닫기
            </Button>
          </DialogActions>
        </Dialog>
      }
    >
      <Suspense fallback={null}>
        <ExportHtmlDialog open={open} onClose={onClose} targets={targets} />
      </Suspense>
    </ChunkErrorBoundary>
  );
}
