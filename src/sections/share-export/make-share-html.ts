import { Result } from 'effect';
import { buildShareDoc, type BuildShareOptions } from 'src/domain/share/build-share';
import { injectShareDoc, shareFileName } from 'src/domain/share/inject';
import type { Library } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { ShareDocSchema } from 'src/schema/share';
import { ShareDocInvalid } from 'src/services/errors';

export type ShareHtml = { html: string; fileName: string; count: number };

/**
 * 이미 받은 틀로 공유 파일(HTML 문자열과 파일 이름)을 바로 만든다. 네트워크를 쓰지 않는 동기 함수라,
 * 공유 창처럼 사용자 동작 직후에 불러야 하는 곳에서 쓴다. `count`는 실제로 담긴 장소 수.
 * 장소가 0곳이어도 만든다(막는 것은 내보내기 창의 몫). 검증 실패는 삼키지 않고 `ShareDocInvalid` 실패로
 * 돌려준다. 틀은 내보내기 창이 `ShareTemplate`로 미리 받아 넘기고, 실패하면 창 안에 안내 문구를 보이며
 * 틀 실패가 아닌 것(프로그램 오류)은 `console.error`로 남긴다.
 */
export function renderShareHtml(
  template: string,
  lib: Library,
  placeIds: readonly string[],
  opts: BuildShareOptions,
): Result.Result<ShareHtml, ShareDocInvalid> {
  const doc = buildShareDoc(lib, placeIds, opts);
  const parsed = safeParse(ShareDocSchema, doc, { onExcessProperty: 'error' });
  if (!parsed.success) {
    const first = parsed.issues[0];
    return Result.fail(
      new ShareDocInvalid({
        message: `공유 데이터가 올바르지 않아요: ${first ? `${first.path}: ${first.message}` : '검증에 실패했어요'}`,
      }),
    );
  }
  return Result.succeed({
    html: injectShareDoc(template, doc),
    fileName: shareFileName(opts.title, opts.now),
    count: doc.places.length,
  });
}
