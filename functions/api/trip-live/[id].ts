import { globalFetch } from '../../../src/server/handler';
import type { MeetContext } from '../../../src/server/meet/env';
import {
  handleLiveGet,
  handleLiveUpdate,
  handleLiveDelete,
} from '../../../src/server/trip-live/handlers';
const deps = { fetch: globalFetch, now: () => new Date() };
export const onRequestGet = (ctx: MeetContext): Promise<Response> => handleLiveGet(ctx, deps);
export const onRequestPut = (ctx: MeetContext): Promise<Response> => handleLiveUpdate(ctx, deps);
export const onRequestDelete = (ctx: MeetContext): Promise<Response> => handleLiveDelete(ctx, deps);
