import { buildTripShareDoc } from 'src/domain/share/build-trip-share';
import type { LiveTripDoc } from 'src/domain/trip-live/live-doc';
import { buildLiveLibrary } from './builders';
export function buildLiveDoc(): LiveTripDoc {
  return {
    format: 'landmark-trip-live',
    v: 1,
    share: buildTripShareDoc(
      buildLiveLibrary(),
      'trip000001',
      () => ({
        durationS: 0,
        distanceM: 0,
        tollFare: null,
        status: 'estimated',
        queriedAt: null,
        path: [],
      }),
      {
        title: '시험 여행',
        includeMemo: false,
        includeCandidates: true,
        now: new Date('2026-11-01T00:00:00Z'),
      },
    )!,
    ids: { days: ['day00001', 'day00002'], stops: [['stop0001'], ['stop0002']] },
    options: { includeMemo: false, includeCandidates: true },
  };
}
