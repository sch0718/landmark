import { globalFetch } from '../../../src/server/handler';
import type { MeetContext } from '../../../src/server/meet/env';
import { handleShareCreate } from '../../../src/server/share/handlers';

export const onRequestPost = (ctx: MeetContext): Promise<Response> =>
  handleShareCreate(ctx, { fetch: globalFetch, now: () => new Date() });
