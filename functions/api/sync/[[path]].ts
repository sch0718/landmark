import { handleSync } from '../../../src/server/library-sync/router';
import { productionDeps, type SyncContext } from '../../../src/server/library-sync/env';
const deps = productionDeps();
export const onRequest = (ctx: SyncContext): Promise<Response> => handleSync(ctx, deps);
