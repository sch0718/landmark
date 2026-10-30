import { globalFetch } from '../../../../src/server/handler';
import type { MeetContext } from '../../../../src/server/meet/env';
import { handleCollabInvitePreview } from '../../../../src/server/trip-collab/handlers';
const deps = { fetch: globalFetch, now: () => new Date() };
export const onRequestGet = (ctx: MeetContext): Promise<Response> =>
  handleCollabInvitePreview(ctx, deps);
