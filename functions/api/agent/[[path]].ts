import { handleAgent } from '../../../src/server/agent/router';
import { productionDeps, type SyncContext } from '../../../src/server/library-sync/env';
const deps = productionDeps();
export const onRequest = (ctx: SyncContext): Promise<Response> => handleAgent(ctx, deps);
