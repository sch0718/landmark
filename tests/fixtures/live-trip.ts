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

// 2A가 엄격하게 읽는 기록 필드 집합을 고정해 롤백 호환을 확인한다.
export const LIVE_RECORD_2A_KEYS = new Set([
  'tripId',
  'liveId',
  'status',
  'ownerToken',
  'nextOwnerToken',
  'viewToken',
  'rev',
  'dayIds',
  'options',
  'createdAt',
  'publishedKey',
  'publishedAt',
  'expiresAt',
  'paused',
]);
