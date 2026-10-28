import { globalFetch } from '../../src/server/handler';
import type { MeetContext } from '../../src/server/meet/env';
import { handleShareOpen } from '../../src/server/share/handlers';

export const onRequestGet = (ctx: MeetContext): Promise<Response> =>
  handleShareOpen(ctx, { fetch: globalFetch, now: () => new Date() });
