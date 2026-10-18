import type { ShareDocV2, ShareLeg } from 'src/schema/share';

/** 관계 검사·읽기 시험이 함께 쓰는 정상 v2 공유 문서(장소 6곳·Day 2개). */
export const IDS = {
  home: 'home000001',
  hotel: 'hotel00001',
  a: 'placea0001',
  b: 'placeb0001',
  c: 'placec0001',
  d: 'placed0001',
};

export function leg(from: string, to: string, extra: Partial<ShareLeg> = {}): ShareLeg {
  return {
    from,
    to,
    mode: 'car',
    durationS: 600,
    distanceM: 5000,
    tollFare: null,
    status: 'routed',
    queriedAt: '2026-10-16T04:58:00.000Z',
    path: [
      [128.9, 37.7],
      [128.91, 37.71],
    ],
    ...extra,
  };
}

export function makeShareV2Doc(): ShareDocV2 {
  const place = (id: string, i: number) => ({
    id,
    name: `장소 ${i}`,
    address: '강원 강릉시',
    lng: 128.9 + i / 100,
    lat: 37.7 + i / 100,
    labelIds: [],
  });
  return {
    format: 'tripmap-share',
    version: 2,
    title: '강릉',
    createdAt: '2026-10-16T05:00:00.000Z',
    labels: [],
    places: Object.values(IDS).map(place),
    trips: [
      {
        title: '강릉 1박 2일',
        startDate: '2026-10-24',
        endDate: '2026-10-25',
        originId: IDS.home,
        candidateIds: [IDS.d],
        legModes: { [`${IDS.a}>${IDS.b}`]: 'walk' },
        days: [
          {
            startTime: '09:00',
            lodgingId: IDS.hotel,
            stops: [
              { placeId: IDS.a, stayMin: 60, fixedTime: null },
              { placeId: IDS.b, stayMin: null, fixedTime: '12:00', note: '점심' },
            ],
            legs: [
              leg(IDS.home, IDS.a),
              leg(IDS.a, IDS.b, { mode: 'walk' }),
              leg(IDS.b, IDS.hotel),
            ],
          },
          {
            startTime: '09:30',
            lodgingId: null,
            stops: [{ placeId: IDS.c, stayMin: 30, fixedTime: null }],
            legs: [leg(IDS.hotel, IDS.c)],
          },
        ],
      },
    ],
  };
}
