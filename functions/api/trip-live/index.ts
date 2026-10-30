import { globalFetch } from '../../../src/server/handler';
import type { MeetContext } from '../../../src/server/meet/env';
import { handleLiveCreate } from '../../../src/server/trip-live/handlers';
export const onRequestPost = (ctx: MeetContext): Promise<Response> =>
  handleLiveCreate(ctx, { fetch: globalFetch, now: () => new Date() });
