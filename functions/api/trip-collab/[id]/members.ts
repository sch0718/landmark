import { globalFetch } from '../../../../src/server/handler';
import type { MeetContext } from '../../../../src/server/meet/env';
import { handleCollabMembers } from '../../../../src/server/trip-collab/handlers';
const deps = { fetch: globalFetch, now: () => new Date() };
export const onRequestGet = (ctx: MeetContext): Promise<Response> => handleCollabMembers(ctx, deps);
