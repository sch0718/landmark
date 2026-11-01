import { useAtom } from 'jotai';
import { lazy, Suspense } from 'react';
import { loadAgentInboxDialog } from 'src/services/agent-inbox/boot';
import { agentInboxOpenAtom } from 'src/stores/agent-inbox';

const AgentInboxDialog = lazy(() =>
  loadAgentInboxDialog().then((module) => ({ default: module.AgentInboxDialog })),
);

export function AgentInboxHost() {
  const [open, setOpen] = useAtom(agentInboxOpenAtom);
  return open ? (
    <Suspense fallback={null}>
      <AgentInboxDialog open={open} onClose={() => setOpen(false)} />
    </Suspense>
  ) : null;
}
