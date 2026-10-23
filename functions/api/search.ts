// GET /api/search?q=검색어[&near=경도,위도] → 이름·주소·분류·좌표(최대 10곳).
import { searchCacheKey } from '../../src/server/cache-key';
import { globalFetch, handleGet, type FunctionContext } from '../../src/server/handler';
import {
  parseSearchInputKey,
  parseSearchQuery,
  resolveSearch,
  searchInputKey,
} from '../../src/server/search';

export const onRequestGet = (ctx: FunctionContext): Promise<Response> =>
  handleGet(ctx, {
    readInput: (url) => searchInputKey(parseSearchQuery(url)),
    maxAgeSeconds: 604_800,
    cacheKey: searchCacheKey,
    resolve: (input) => resolveSearch(parseSearchInputKey(input), { fetch: globalFetch }),
  });
