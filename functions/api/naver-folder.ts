// GET /api/naver-folder?share=<공유 ID> → 폴더 이름과 장소 목록(최대 1,000곳).
// wrangler(esbuild)에는 `src/` 별칭이 없어 상대 경로로 가져온다.
import { cacheKey } from '../../src/server/cache-key';
import { globalFetch, handleGet, type FunctionContext } from '../../src/server/handler';
import { resolveFolder } from '../../src/server/resolve';

const TEN_MINUTES_SECONDS = 600;

export const onRequestGet = (ctx: FunctionContext): Promise<Response> =>
  handleGet(ctx, {
    param: 'share',
    missingMessage: '공유 ID가 없음',
    maxAgeSeconds: TEN_MINUTES_SECONDS,
    cacheKey: (input) => cacheKey('folder', input),
    resolve: (input) => resolveFolder(input, { fetch: globalFetch }),
  });
