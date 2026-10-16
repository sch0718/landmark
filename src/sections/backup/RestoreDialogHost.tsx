import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { Suspense, useId, useState, type ReactNode } from 'react';
import { ChunkErrorBoundary } from 'src/components/ChunkErrorBoundary';
import { ChunkErrorNotice } from 'src/components/ChunkErrorNotice';
import { LoadingNotice } from 'src/components/LoadingNotice';
import { RestoreDialog } from 'src/routes/lazy-routes';
import type { RestoreDialogProps } from 'src/sections/backup/RestoreDialog';

/** 실제 대화상자가 오기 전에 보이는 틀: 같은 제목과 취소 버튼 안에 `children`(기다림·새 버전 안내)을 넣는다. */
function ShellDialog({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose(): void;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId} fullWidth maxWidth="xs">
      <DialogTitle id={titleId}>백업에서 되살리기</DialogTitle>
      <DialogContent>{children}</DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ minHeight: 44 }}>
          취소
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * 되살리기 대화상자(`RestoreDialog`)를 처음 열 때 받아 그린다(`ExportHtmlDialogHost`와 같은 모양). 한 번 열린 뒤에는
 * 닫아도 마운트를 지우지 않고 `open`만 바꾼다: 대화상자는 `open`이 바뀔 때 진행 중인 읽기·바꾸기의 결과를 버리므로
 * 마운트를 지우면 그 규칙이 빠진다. 받는 동안은 같은 제목의 틀 안에 기다림 표시를, 받지 못하면 새 버전 안내를 보인다.
 */
export function RestoreDialogHost(props: RestoreDialogProps) {
  const { open, onClose } = props;
  // 렌더 중 상태 갱신으로, 처음 열리는 그 렌더부터 마운트한다.
  const [everOpened, setEverOpened] = useState(open);
  if (open && !everOpened) setEverOpened(true);
  if (!everOpened) return null;
  return (
    <ChunkErrorBoundary
      fallback={
        <ShellDialog open={open} onClose={onClose}>
          <ChunkErrorNotice />
        </ShellDialog>
      }
    >
      <Suspense
        fallback={
          <ShellDialog open={open} onClose={onClose}>
            <LoadingNotice />
          </ShellDialog>
        }
      >
        <RestoreDialog {...props} />
      </Suspense>
    </ChunkErrorBoundary>
  );
}
