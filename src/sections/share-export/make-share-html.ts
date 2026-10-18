import { Result } from 'effect';
import { buildShareDoc, type BuildShareOptions } from 'src/domain/share/build-share';
import {
  buildTripShareDoc,
  type BuildTripShareOptions,
  type ShareLegTime,
} from 'src/domain/share/build-trip-share';
import { checkShareTrip } from 'src/domain/share/check-share-trip';
import { injectShareDoc, shareFileName } from 'src/domain/share/inject';
import { SHARE_IMPORT_LIMITS } from 'src/domain/share/read-share';
import type { Leg } from 'src/domain/trips/query';
import type { Library } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { ShareDocSchema, ShareDocV2Schema } from 'src/schema/share';
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

/**
 * 여행 하나를 일정 공유 파일(v2)로 만든다. `renderShareHtml`과 같이 동기 함수이며 `count`는 장소 수다.
 * 여행이 없거나 지웠으면, 스키마나 관계 검사(`checkShareTrip`)에 걸리면 `ShareDocInvalid`로 돌려준다.
 */
export function renderTripShareHtml(
  template: string,
  lib: Library,
  tripId: string,
  routeOf: (leg: Leg) => ShareLegTime,
  opts: BuildTripShareOptions,
): Result.Result<ShareHtml, ShareDocInvalid> {
  const doc = buildTripShareDoc(lib, tripId, routeOf, opts);
  if (doc === null) return Result.fail(new ShareDocInvalid({ message: '여행을 찾지 못했어요' }));
  const parsed = safeParse(ShareDocV2Schema, doc, { onExcessProperty: 'error' });
  if (!parsed.success) {
    const first = parsed.issues[0];
    return Result.fail(
      new ShareDocInvalid({
        message: `공유 데이터가 올바르지 않아요: ${first ? `${first.path}: ${first.message}` : '검증에 실패했어요'}`,
      }),
    );
  }
  const problems = checkShareTrip(doc);
  if (problems.length > 0) {
    return Result.fail(
      new ShareDocInvalid({ message: `공유 데이터가 올바르지 않아요: ${problems[0]}` }),
    );
  }
  return Result.succeed({
    html: injectShareDoc(template, doc),
    fileName: shareFileName(opts.title, opts.now),
    count: doc.places.length,
  });
}

/** 가져오기 한도와 같은 값. 만든 파일이 이 값과 같으면 통과한다. */
export const SHARE_FILE_MAX_BYTES: number = SHARE_IMPORT_LIMITS.fileBytes;

/** 최종 파일 바이트(UTF-8). `File([html]).size`와 같다. */
export function shareHtmlBytes(html: string): number {
  return new TextEncoder().encode(html).byteLength;
}
