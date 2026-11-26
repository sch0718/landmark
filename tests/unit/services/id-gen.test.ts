import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { randomId, randomToken } from 'src/lib/random';
import { LabelId, PlaceId } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { IdGen } from 'src/services/id-gen';

const run = <A>(use: (gen: IdGen['Service']) => A, layer = IdGen.layer) =>
  Effect.runSync(
    Effect.gen(function* () {
      return use(yield* IdGen);
    }).pipe(Effect.provide(layer)),
  );
const next = (kind: 'place' | 'label' | 'trip' | 'stop') => run((g) => g.next(kind));

describe('IdGen', () => {
  it('무작위 ID는 지정한 길이의 영숫자 소문자이고 토큰은 43자 base64url이다', () => {
    for (const length of [8, 10, 16]) {
      expect(randomId(length)).toMatch(new RegExp(`^[a-z0-9]{${length}}$`));
    }
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('makes lowercase alphanumeric ids of length 10 (place) and 8 (label)', () => {
    for (let i = 0; i < 200; i++) {
      expect(next('place')).toMatch(/^[a-z0-9]{10}$/);
      expect(next('label')).toMatch(/^[a-z0-9]{8}$/);
    }
    expect(safeParse(PlaceId, next('place')).success).toBe(true);
    expect(safeParse(LabelId, next('label')).success).toBe(true);
  });

  it('makes ids of length 10 (trip) and 8 (stop)', () => {
    for (let i = 0; i < 200; i++) {
      expect(next('trip')).toMatch(/^[a-z0-9]{10}$/);
      expect(next('stop')).toMatch(/^[a-z0-9]{8}$/);
    }
  });

  it('does not repeat in a small sample', () => {
    const ids = new Set(Array.from({ length: 500 }, () => next('place')));
    expect(ids.size).toBe(500);
  });

  it('layerSequence returns ids in order and throws when exhausted', () => {
    const ids = run((g) => [g.next('place'), g.next('label')], IdGen.layerSequence(['a', 'b']));
    expect(ids).toEqual(['a', 'b']);
    expect(() => run((g) => g.next('place'), IdGen.layerSequence([]))).toThrow();
  });
});
