import type { ShareDocV2 } from 'src/schema/share';

/** 원시 사전 검사와 받은함이 함께 거절해야 하는 모양 오류·큰 모음. */
export function agentRawCases(doc: ShareDocV2) {
  const trip = doc.trips[0]!;
  const day = trip.days[0]!;
  const withTrip = (patch: Record<string, unknown>) => ({
    ...doc,
    trips: [{ ...trip, ...patch }],
  });
  const withDay = (patch: Record<string, unknown>) =>
    withTrip({ days: [{ ...day, ...patch }, ...trip.days.slice(1)] });
  const withPlace = (place: unknown) => ({ ...doc, places: [place, ...doc.places.slice(1)] });
  const corrupt: [string, unknown][] = [
    ['null 루트', null],
    ['불리언 루트', false],
    ['숫자 루트', 1],
    ['문자열 루트', '문서'],
    ['배열 루트', []],
    ['빈 객체', {}],
    ['labels 누락', { ...doc, labels: undefined }],
    ['labels 객체', { ...doc, labels: {} }],
    ['places 누락', { ...doc, places: undefined }],
    ['places 객체', { ...doc, places: {} }],
    ['trips 누락', { ...doc, trips: undefined }],
    ['trips null', { ...doc, trips: null }],
    ['빈 trips', { ...doc, trips: [] }],
    ['여행 두 개', { ...doc, trips: [trip, trip] }],
    ['여행 null', { ...doc, trips: [null] }],
    ['여행 배열', { ...doc, trips: [[]] }],
    ['days null', withTrip({ days: null })],
    ['days 31개', withTrip({ days: Array.from({ length: 31 }, () => day) })],
    ['날짜 null', withTrip({ days: [null] })],
    ['날짜 배열', withTrip({ days: [[]] })],
    ['stops 객체', withDay({ stops: {} })],
    ['legs null', withDay({ legs: null })],
    [
      '구간 수 초과',
      withDay({ legs: Array.from({ length: day.stops.length + 2 }, () => day.legs[0]) }),
    ],
    ['Stop null', withDay({ stops: [null] })],
    ['Stop 배열', withDay({ stops: [[]] })],
    ['구간 null', withDay({ legs: [null] })],
    ['구간 배열', withDay({ legs: [[]] })],
    ['path 객체', withDay({ legs: [{ ...day.legs[0], path: {} }] })],
    ['legModes 배열', withTrip({ legModes: [] })],
    ['legModes null', withTrip({ legModes: null })],
    ['candidateIds 누락', withTrip({ candidateIds: undefined })],
    ['candidateIds 객체', withTrip({ candidateIds: {} })],
    ['장소 null', withPlace(null)],
    ['장소 배열', withPlace([])],
    ['장소 labelIds 누락', withPlace({ ...doc.places[0], labelIds: undefined })],
    ['장소 labelIds 객체', withPlace({ ...doc.places[0], labelIds: {} })],
    [
      '장소보다 많은 Stop',
      withDay({ stops: Array.from({ length: doc.places.length + 1 }, () => day.stops[0]) }),
    ],
    [
      '장소보다 많은 후보',
      withTrip({ candidateIds: Array.from({ length: doc.places.length + 1 }, () => 'p') }),
    ],
    [
      'Stop과 후보 합계 초과',
      withTrip({ candidateIds: Array.from({ length: doc.places.length }, () => 'p') }),
    ],
    [
      'labels 누락과 path null 40000개',
      {
        ...withDay({ legs: [{ ...day.legs[0], path: Array(40_000).fill(null) }] }),
        labels: undefined,
      },
    ],
  ];
  return [
    ...corrupt.map(([name, value]) => ({ name, value, reason: 'corrupt' as const })),
    {
      name: '장소 labelIds null 40000개',
      value: withPlace({ ...doc.places[0], labelIds: Array(40_000).fill(null) }),
      reason: 'labels' as const,
    },
  ];
}
