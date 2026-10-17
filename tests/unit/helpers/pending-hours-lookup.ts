import { Effect, Layer } from 'effect';
import { HoursLookup } from 'src/services/hours-lookup';

/**
 * 테스트 기본 영업시간 조회: 캐시는 비어 있고(`peek` → null) 요청은 끝나지 않는다.
 * 행에 영업시간 줄이 나오지 않아 기존 화면 시험이 그대로 통과한다. 서버에 묻지 않고 콘솔 경고도 내지 않는다.
 */
export const PENDING_HOURS_LOOKUP: Layer.Layer<HoursLookup> = Layer.succeed(
  HoursLookup,
  HoursLookup.of({
    peek: () => null,
    place: () => Effect.never,
  }),
);
