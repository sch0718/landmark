import { globalFetch } from '../../../../src/server/handler';
import type { MeetContext } from '../../../../src/server/meet/env';
import { handleCollabAccept } from '../../../../src/server/trip-collab/handlers';
const deps = { fetch: globalFetch, now: () => new Date() };
export const onRequestPost = (ctx: MeetContext): Promise<Response> => handleCollabAccept(ctx, deps);
