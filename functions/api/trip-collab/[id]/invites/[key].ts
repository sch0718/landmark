import { globalFetch } from '../../../../../src/server/handler';
import type { MeetContext } from '../../../../../src/server/meet/env';
import { handleCollabInviteCancel } from '../../../../../src/server/trip-collab/handlers';
const deps = { fetch: globalFetch, now: () => new Date() };
export const onRequestDelete = (ctx: MeetContext): Promise<Response> =>
  handleCollabInviteCancel(ctx, deps);
