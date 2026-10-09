import { readFileSync } from 'node:fs';
import { safeParse } from 'src/schema/parse';
import { TRIP_DATA_PARSE, TripDataSchema } from 'src/schema/legacy/trip-data';
import { describe, expect, it } from 'vitest';

describe('E2E fixture TripData', () => {
  it('tests/fixtures/trips/e2e.json은 TripDataSchema를 통과한다', () => {
    const raw: unknown = JSON.parse(readFileSync('tests/fixtures/trips/e2e.json', 'utf-8'));
    const parsed = safeParse(TripDataSchema, raw, TRIP_DATA_PARSE);
    expect(parsed.success ? undefined : parsed.issues).toBeUndefined();
    const data = parsed.success ? parsed.data : undefined;
    expect(data?.publicId).toBe('e2etest000001');
    // legacy-import.spec이 장소 42곳 가져오기를 기대한다.
    expect(Object.keys(data?.places ?? {})).toHaveLength(42);
  });
});
