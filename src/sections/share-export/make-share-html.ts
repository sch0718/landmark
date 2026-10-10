import { Effect } from 'effect';
import { buildShareDoc, type BuildShareOptions } from 'src/domain/share/build-share';
import { injectShareDoc, shareFileName } from 'src/domain/share/inject';
import type { Library } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { ShareDocSchema } from 'src/schema/share';
import { ShareDocInvalid, type ShareTemplateUnavailable } from 'src/services/errors';
import { ShareTemplate } from 'src/services/share-template';

/**
 * 고른 장소로 공유 파일(HTML 문자열과 파일 이름)을 만든다. `count`는 실제로 담긴 장소 수.
 * 장소가 0곳이어도 만든다(막는 것은 내보내기 창의 몫). 검증 실패는 삼키지 않고 `ShareDocInvalid`
 * 실패로 돌려준다. `startEffect`는 실패를 보고하지 않으므로, 내보내기 창이 받아서 창 안에 안내 문구를
 * 보이고 틀 실패가 아닌 것(프로그램 오류)은 `console.error`로 남긴다.
 */
export function makeShareHtml(
  lib: Library,
  placeIds: readonly string[],
  opts: BuildShareOptions,
): Effect.Effect<
  { html: string; fileName: string; count: number },
  ShareTemplateUnavailable | ShareDocInvalid,
  ShareTemplate
> {
  return Effect.gen(function* () {
    const doc = buildShareDoc(lib, placeIds, opts);
    const parsed = safeParse(ShareDocSchema, doc, { onExcessProperty: 'error' });
    if (!parsed.success) {
      const first = parsed.issues[0];
      return yield* new ShareDocInvalid({
        message: `공유 데이터가 올바르지 않아요: ${first ? `${first.path}: ${first.message}` : '검증에 실패했어요'}`,
      });
    }
    const template = yield* (yield* ShareTemplate).load;
    return {
      html: injectShareDoc(template, doc),
      fileName: shareFileName(opts.title, opts.now),
      count: doc.places.length,
    };
  });
}
