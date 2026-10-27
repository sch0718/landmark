import { globalFetch } from '../../../src/server/handler';
import type { MeetContext } from '../../../src/server/meet/env';
import { handleCreate } from '../../../src/server/meet/handlers';

export const onRequestPost = (ctx: MeetContext): Promise<Response> =>
  handleCreate(ctx, { fetch: globalFetch, now: () => new Date() });
