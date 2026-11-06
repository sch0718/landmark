import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { useAtom } from 'jotai';
import { lazy, Suspense, useCallback, useId } from 'react';
import { ChunkErrorBoundary } from 'src/components/ChunkErrorBoundary';
import { ChunkErrorNotice } from 'src/components/ChunkErrorNotice';
import { loadAgentChangesDialog, loadAgentInboxDialog } from 'src/services/agent-inbox/boot';
import { agentChangesOpenAtom, agentInboxOpenAtom } from 'src/stores/agent-inbox';

const AgentInboxDialog = lazy(() =>
  loadAgentInboxDialog().then((module) => ({ default: module.AgentInboxDialog })),
);

const AgentChangesDialog = lazy(() =>
  loadAgentChangesDialog().then((module) => ({ default: module.AgentChangesDialog })),
);

function AgentChangesHost() {
  const [open, setOpen] = useAtom(agentChangesOpenAtom);
  const titleId = useId();
  const close = useCallback(() => setOpen(false), [setOpen]);
  return open ? (
    <ChunkErrorBoundary
      fallback={
        <Dialog open={open} onClose={close} aria-labelledby={titleId} fullWidth maxWidth="xs">
          <DialogTitle id={titleId}>AI 변경 기록</DialogTitle>
          <DialogContent>
            <ChunkErrorNotice />
          </DialogContent>
          <DialogActions>
            <Button onClick={close} sx={{ minHeight: 44 }}>
              닫기
            </Button>
          </DialogActions>
        </Dialog>
      }
    >
      <Suspense fallback={null}>
        <AgentChangesDialog open={open} onClose={close} />
      </Suspense>
    </ChunkErrorBoundary>
  ) : null;
}

export function AgentInboxHost() {
  return (
    <>
      <AgentInboxDialogHost />
      <AgentChangesHost />
    </>
  );
}

function AgentInboxDialogHost() {
  const [open, setOpen] = useAtom(agentInboxOpenAtom);
  const titleId = useId();
  const close = useCallback(() => setOpen(false), [setOpen]);
  return open ? (
    <ChunkErrorBoundary
      fallback={
        <Dialog open={open} onClose={close} aria-labelledby={titleId} fullWidth maxWidth="xs">
          <DialogTitle id={titleId}>AI가 보낸 일정</DialogTitle>
          <DialogContent>
            <ChunkErrorNotice />
          </DialogContent>
          <DialogActions>
            <Button onClick={close} sx={{ minHeight: 44 }}>
              닫기
            </Button>
          </DialogActions>
        </Dialog>
      }
    >
      <Suspense fallback={null}>
        <AgentInboxDialog open={open} onClose={close} />
      </Suspense>
    </ChunkErrorBoundary>
  ) : null;
}
