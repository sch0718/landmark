// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { importLiveTrip } from 'src/domain/trip-live/import-live';
import { buildLiveLibrary } from '../../../fixtures/builders';
import { buildLiveDoc } from '../../../fixtures/live-trip';
const ctx = () => {
  let n = 0;
  return {
    now: '2026-11-01T00:00:00Z',
    newId: (kind: string) =>
      `${kind === 'stop' ? 's' : 'p'}${String(++n).padStart(kind === 'stop' ? 7 : 9, '0')}`,
  };
};
describe('공개본 새 여행으로 담기', () => {
  it.each([null, 'trip000001', 'empty00001'])(
    '원래 id %s가 비었을 때만 쓰고 Stop id는 보존한다',
    (preferredTripId) => {
      const lib = buildLiveLibrary(),
        r = importLiveTrip(lib, buildLiveDoc(), { preferredTripId }, ctx());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.createdId).toEqual(
        preferredTripId === 'empty00001' ? 'empty00001' : expect.not.stringMatching(/^trip000001$/),
      );
      expect(r.lib.trips[r.createdId!]!.days.map((d) => d.stops.value.map((s) => s.id))).toEqual(
        buildLiveDoc().ids.stops,
      );
      expect(Object.keys(r.lib.places)).toHaveLength(2);
      expect(Object.keys(lib.trips)).toHaveLength(1);
    },
  );
});
