import { globalFetch } from '../../../src/server/handler';
import type { MeetContext } from '../../../src/server/meet/env';
import { handleGet, handleUpdate, handleDelete } from '../../../src/server/meet/handlers';

export const onRequestGet = (ctx: MeetContext): Promise<Response> =>
  handleGet(ctx, { fetch: globalFetch, now: () => new Date() });

export const onRequestPut = (ctx: MeetContext): Promise<Response> =>
  handleUpdate(ctx, { fetch: globalFetch, now: () => new Date() });

export const onRequestDelete = (ctx: MeetContext): Promise<Response> =>
  handleDelete(ctx, { fetch: globalFetch, now: () => new Date() });
