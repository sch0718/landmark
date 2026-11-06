import { lazyChunk } from 'src/lib/lazy-chunk';
export const loadAgentInbox = lazyChunk(() => import('src/services/agent-inbox/inbox-check'));
export const loadAgentInboxDialog = lazyChunk(() => import('src/sections/agent/AgentInboxDialog'));
export const loadAgentSection = lazyChunk(() => import('src/sections/agent/AgentSection'));
export const loadAgentChangesDialog = lazyChunk(
  () => import('src/sections/agent/AgentChangesDialog'),
);
