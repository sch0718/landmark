import { globalFetch } from '../../../src/server/handler';
import type { MeetContext } from '../../../src/server/meet/env';
import { handleShareDelete } from '../../../src/server/share/handlers';

export const onRequestDelete = (ctx: MeetContext): Promise<Response> =>
  handleShareDelete(ctx, { fetch: globalFetch, now: () => new Date() });
