// GET /api/place?url=<지도 링크> → 장소 하나 또는 네이버 공유 폴더 참조.
// wrangler(esbuild)에는 `src/` 별칭이 없어 상대 경로로 가져온다.
import { ApiError } from '../../src/server/http';
import { cacheKey } from '../../src/server/cache-key';
import { globalFetch, handleGet, type FunctionContext } from '../../src/server/handler';
import { classifyLink } from '../../src/server/links';
import { resolveLink } from '../../src/server/resolve';

const ONE_DAY_SECONDS = 86_400;

export const onRequestGet = (ctx: FunctionContext): Promise<Response> =>
  handleGet(ctx, {
    readInput: (url) => {
      const input = url.searchParams.get('url') ?? '';
      if (input.trim() === '') throw new ApiError('UNSUPPORTED_LINK', '링크가 없음');
      return input;
    },
    maxAgeSeconds: ONE_DAY_SECONDS,
    // 지원하지 않는 링크는 해석에서 바로 UNSUPPORTED_LINK가 되니 캐시를 보지 않는다.
    cacheKey: (input) =>
      classifyLink(input).kind === 'unsupported' ? null : cacheKey('place', input),
    resolve: (input) => resolveLink(input, { fetch: globalFetch }),
  });
