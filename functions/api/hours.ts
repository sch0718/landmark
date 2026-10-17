// GET /api/hours?sid=<네이버 장소 ID>[&fresh=1] → 요일별 영업시간·휴무(네이버 장소 홈에서 읽음).
// `fresh=1`(다시 확인)은 엣지 캐시를 보지 않고 새로 받는다. 캐시 키에는 넣지 않아 새 결과가 보통 요청에도 쓰인다.
// wrangler(esbuild)에는 `src/` 별칭이 없어 상대 경로로 가져온다.
import { hoursCacheKey } from '../../src/server/cache-key';
import { globalFetch, handleGet, type FunctionContext } from '../../src/server/handler';
import { parseHoursQuery, resolveHours } from '../../src/server/hours';

const ONE_DAY_SECONDS = 86_400;

export const onRequestGet = (ctx: FunctionContext): Promise<Response> =>
  handleGet(ctx, {
    readInput: parseHoursQuery,
    maxAgeSeconds: ONE_DAY_SECONDS,
    cacheKey: hoursCacheKey,
    bypassCache: (url) => url.searchParams.get('fresh') === '1',
    resolve: (sid) => resolveHours(sid, { fetch: globalFetch }),
  });
