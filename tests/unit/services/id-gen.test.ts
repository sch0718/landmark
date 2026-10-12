import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
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
