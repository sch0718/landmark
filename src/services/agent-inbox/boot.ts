import { lazyChunk } from 'src/lib/lazy-chunk';
export const loadAgentInbox = lazyChunk(() => import('src/services/agent-inbox/inbox-check'));
