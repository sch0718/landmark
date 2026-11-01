import { defaultTitleLabel } from 'src/domain/library/import-share';
import { importSharedTrip } from 'src/domain/library/import-share-trip';
import { emptyLibrary } from 'src/schema/library';
import type { ShareDocV2, ShareTrip } from 'src/schema/share';

/** 받은함 상한인 장소 200곳·30일과 줄바꿈 메모 500자를 가진 문서. */
export function largeAgentDoc(): ShareDocV2 {
  const places = Array.from({ length: 200 }, (_, i) => ({
    id: `p${i}`,
    name: `장소 ${i}`,
    address: '',
    lng: 127,
    lat: 37,
    labelIds: [],
  }));
  const days: ShareTrip['days'] = Array.from({ length: 30 }, (_, d) => {
    const stops = places
      .filter((_, i) => Math.floor((i * 30) / places.length) === d)
      .map((place) => ({
        placeId: place.id,
        stayMin: null,
        fixedTime: null,
        note: '\n'.repeat(500),
      }));
    return {
      startTime: '09:00',
      lodgingId: null,
      stops,
      legs: stops.slice(1).map((stop, i) => ({
        from: stops[i]!.placeId,
        to: stop.placeId,
        mode: 'car',
        durationS: 60,
        distanceM: 100,
        tollFare: null,
        status: 'estimated',
        queriedAt: null,
        path: [],
      })),
    };
  });
  return {
    format: 'tripmap-share',
    version: 2,
    title: '상한 여행',
    createdAt: '2026-11-01T00:00:00.000Z',
    labels: [],
    places,
    trips: [
      {
        title: '상한 여행',
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        originId: null,
        candidateIds: [],
        days,
        legModes: {},
      },
    ],
  };
}

/** 앱과 같은 길이의 id로 가져온 항목 크기를 독립적으로 확인한다. */
export function importedAgentLibrary(doc: ShareDocV2) {
  let sequence = 0;
  const result = importSharedTrip(
    emptyLibrary(),
    doc,
    { titleLabel: defaultTitleLabel(doc.title), appendMemo: true },
    {
      now: '2026-11-01T00:00:00.000Z',
      newId: (kind) =>
        (++sequence).toString(36).padStart(kind === 'label' || kind === 'stop' ? 8 : 10, '0'),
    },
  );
  if (!result.ok) throw new Error(`시험 문서 가져오기 실패: ${result.error._tag}`);
  return result.lib;
}
