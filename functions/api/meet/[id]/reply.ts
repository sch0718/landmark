import { globalFetch } from '../../../../src/server/handler';
import type { MeetContext } from '../../../../src/server/meet/env';
import { handleReply } from '../../../../src/server/meet/handlers';

export const onRequestPut = (ctx: MeetContext): Promise<Response> =>
  handleReply(ctx, { fetch: globalFetch, now: () => new Date() });
