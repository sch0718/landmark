import { Context, Layer } from 'effect';
import { randomId } from 'src/lib/random';

const LENGTH = {
  place: 10,
  label: 8,
  trip: 10,
  stop: 8,
  booking: 8,
  meeting: 10,
  meetingMember: 8,
} as const;
export type IdKind = keyof typeof LENGTH;

/** 무작위 ID. 장소·여행·약속 id는 10자, 라벨·여행 정류장·약속 구성원 id는 8자의 영숫자 소문자(스펙 §3). */
export class IdGen extends Context.Service<IdGen, { next(kind: IdKind): string }>()(
  'tripmap/IdGen',
) {
  static readonly layer = Layer.succeed(
    IdGen,
    IdGen.of({ next: (kind) => randomId(LENGTH[kind]) }),
  );

  /** 테스트용: 종류와 상관없이 `ids`를 순서대로 돌려준다. 다 쓰면 오류를 던진다. */
  static layerSequence(ids: readonly string[]) {
    return Layer.sync(IdGen, () => {
      let index = 0;
      return IdGen.of({
        next: () => {
          const id = ids[index++];
          if (id === undefined) throw new Error('IdGen.layerSequence: ID를 모두 썼습니다');
          return id;
        },
      });
    });
  }
}
