import { Context, Deferred, Effect, Layer } from 'effect';
import { SHARE_DATA_PLACEHOLDER } from 'src/domain/share/inject';
import { ShareTemplateUnavailable } from 'src/services/errors';

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * 내보낼 HTML의 틀(`share-viewer.html`)을 받아 온다. 성공한 본문은 레이어 안에서 캐시해
 * 같은 세션에서는 한 번만 받고, 실패는 캐시하지 않아 다시 시도할 수 있다.
 * 받는 중에 또 부르면 새로 받지 않고 진행 중인 요청의 결과(성공이든 실패든)를 같이 기다린다.
 * 본문에 데이터 자리 문자열이 정확히 1개가 아니면 잘못된 틀(예: SPA가 돌려준 index.html)로 본다.
 */
export class ShareTemplate extends Context.Service<
  ShareTemplate,
  { readonly load: Effect.Effect<string, ShareTemplateUnavailable> }
>()('tripmap/ShareTemplate') {
  static layerWith(options: { fetch: typeof fetch; url: string }) {
    return Layer.sync(ShareTemplate, () => {
      let cached: string | undefined;
      // 진행 중인 요청. 끝나면(성공·실패·중단 모두) 비운다.
      let inflight: Deferred.Deferred<string, ShareTemplateUnavailable> | undefined;

      const fetchTemplate = Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () => options.fetch(options.url),
          catch: (e) =>
            new ShareTemplateUnavailable({ reason: `틀을 받지 못했어요: ${errorText(e)}` }),
        });
        if (!response.ok) {
          return yield* new ShareTemplateUnavailable({
            reason: `틀을 받지 못했어요: HTTP ${response.status}`,
          });
        }
        const text = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: (e) =>
            new ShareTemplateUnavailable({ reason: `틀을 읽지 못했어요: ${errorText(e)}` }),
        });
        const count = text.split(SHARE_DATA_PLACEHOLDER).length - 1;
        if (count !== 1) {
          return yield* new ShareTemplateUnavailable({
            reason: `틀의 데이터 자리가 ${count}개예요(1개여야 함)`,
          });
        }
        return text;
      });

      const load = Effect.suspend(() => {
        if (cached !== undefined) return Effect.succeed(cached);
        if (inflight !== undefined) return Deferred.await(inflight);
        const pending = Deferred.makeUnsafe<string, ShareTemplateUnavailable>();
        inflight = pending;
        return fetchTemplate.pipe(
          Effect.tap((text) =>
            Effect.sync(() => {
              cached = text;
            }),
          ),
          Effect.onExit((exit) =>
            Effect.suspend(() => {
              inflight = undefined;
              return Deferred.done(pending, exit);
            }),
          ),
        );
      });
      return ShareTemplate.of({ load });
    });
  }

  static readonly layer = Layer.suspend(() =>
    ShareTemplate.layerWith({
      fetch: (...args) => globalThis.fetch(...args),
      url: `${import.meta.env.BASE_URL}share-viewer.html`,
    }),
  );
}
