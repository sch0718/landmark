import { readFileSync } from 'node:fs';
import { TripDataSchema } from 'src/schema/trip-data';
import { describe, expect, it } from 'vitest';

describe('E2E fixture TripData', () => {
  it('tests/fixtures/trips/e2e.json은 TripDataSchema를 통과한다', () => {
    const raw: unknown = JSON.parse(readFileSync('tests/fixtures/trips/e2e.json', 'utf-8'));
    const parsed = TripDataSchema.safeParse(raw);
    expect(parsed.error?.issues).toBeUndefined();
    expect(parsed.data?.publicId).toBe('e2etest000001');
    // concurrent.spec이 장소 1~42를 쓴다.
    expect(Object.keys(parsed.data?.places ?? {})).toHaveLength(42);
  });
});
