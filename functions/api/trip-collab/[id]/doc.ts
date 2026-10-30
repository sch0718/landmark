import { globalFetch } from '../../../../src/server/handler';
import type { MeetContext } from '../../../../src/server/meet/env';
import { handleCollabPutDoc } from '../../../../src/server/trip-collab/handlers';
const deps = { fetch: globalFetch, now: () => new Date() };
export const onRequestPut = (ctx: MeetContext): Promise<Response> => handleCollabPutDoc(ctx, deps);
