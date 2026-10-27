import { globalFetch } from '../../../../src/server/handler';
import type { MeetContext } from '../../../../src/server/meet/env';
import { handleClaim } from '../../../../src/server/meet/handlers';

export const onRequestPost = (ctx: MeetContext): Promise<Response> =>
  handleClaim(ctx, { fetch: globalFetch, now: () => new Date() });
