import { describe, expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';

describe('effect 4 smoke', () => {
  it.effect('runs an Effect and decodes a Schema', () =>
    Effect.gen(function* () {
      const n = yield* Schema.decodeUnknownEffect(Schema.Number)(42);
      expect(n).toBe(42);
    }),
  );
});
