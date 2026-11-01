import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { useAtom } from 'jotai';
import { lazy, Suspense, useId } from 'react';
import { ChunkErrorBoundary } from 'src/components/ChunkErrorBoundary';
import { ChunkErrorNotice } from 'src/components/ChunkErrorNotice';
import { loadAgentInboxDialog } from 'src/services/agent-inbox/boot';
import { agentInboxOpenAtom } from 'src/stores/agent-inbox';

const AgentInboxDialog = lazy(() =>
  loadAgentInboxDialog().then((module) => ({ default: module.AgentInboxDialog })),
);

export function AgentInboxHost() {
  const [open, setOpen] = useAtom(agentInboxOpenAtom);
  const titleId = useId();
  const close = () => setOpen(false);
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
