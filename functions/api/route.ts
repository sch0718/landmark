// GET /api/route?mode=car|walk&from=경도,위도&to=경도,위도[&fresh=1] → 거리·시간·통행료·경로선.
// `fresh=1`(다시 계산)은 엣지 캐시를 보지 않고 새로 받는다. 캐시 키에는 넣지 않아 새 결과가 보통 요청에도 쓰인다.
// wrangler(esbuild)에는 `src/` 별칭이 없어 상대 경로로 가져온다.
import { routeCacheKey } from '../../src/server/cache-key';
import { globalFetch, handleGet, type FunctionContext } from '../../src/server/handler';
import {
  parseRouteInputKey,
  parseRouteQuery,
  resolveRoute,
  routeInputKey,
} from '../../src/server/route';

const ONE_HOUR_SECONDS = 3_600;
const SEVEN_DAYS_SECONDS = 604_800;

export const onRequestGet = (ctx: FunctionContext): Promise<Response> =>
  handleGet(ctx, {
    readInput: (url) => routeInputKey(parseRouteQuery(url)),
    // 자동차는 교통이 바뀌어 1시간, 도보는 길이 거의 안 바뀌어 7일.
    maxAgeSeconds: (input) => (input.startsWith('car:') ? ONE_HOUR_SECONDS : SEVEN_DAYS_SECONDS),
    cacheKey: routeCacheKey,
    bypassCache: (url) => url.searchParams.get('fresh') === '1',
    resolve: (input) => resolveRoute(parseRouteInputKey(input), { fetch: globalFetch }),
  });
