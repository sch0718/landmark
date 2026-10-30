// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildLiveTripDoc,
  ESTIMATE_ONLY,
  fitLiveDoc,
  liveEditKey,
  livePlanKey,
} from 'src/domain/trip-live/build-live-doc';
import { liveDocBytes, LIVE_DOC_MAX_BYTES } from 'src/domain/trip-live/live-doc';
import { buildLiveLibrary } from '../../../fixtures/builders';
import { buildLiveDoc } from '../../../fixtures/live-trip';
const opts = {
  title: '시험 여행',
  options: { includeMemo: false, includeCandidates: true },
  dayIds: ['day00001', 'day00002'],
  createdAt: '2026-11-01T00:00:00.000Z',
};
describe('공개본 만들기', () => {
  it('Day·Stop id를 맞추고 만든 시각을 고정한다', () => {
    expect(buildLiveTripDoc(buildLiveLibrary(), 'trip000001', ESTIMATE_ONLY, opts)).toEqual(
      buildLiveDoc(),
    );
  });
  it('지운 장소의 Stop과 id는 함께 빠진다', () => {
    const lib = buildLiveLibrary();
    const changed = {
      ...lib,
      places: {
        ...lib.places,
        place00001: { ...lib.places.place00001!, deletedAt: opts.createdAt },
      },
    };
    expect(buildLiveTripDoc(changed, 'trip000001', ESTIMATE_ONLY, opts)?.ids.stops).toEqual([
      [],
      ['stop0002'],
    ]);
  });
  it('장소가 없으면 null이고 Day id 길이가 다르면 던진다', () => {
    const lib = buildLiveLibrary();
    expect(() =>
      buildLiveTripDoc(lib, 'trip000001', ESTIMATE_ONLY, { ...opts, dayIds: [] }),
    ).toThrow('dayIds');
    expect(buildLiveTripDoc({ ...lib, places: {} }, 'trip000001', ESTIMATE_ONLY, opts)).toBeNull();
  });
  it('경로선을 모두 합쳐 10,000점 이하로 솎는다', () => {
    const lib = buildLiveLibrary();
    const trip = lib.trips.trip000001!;
    const changed = {
      ...lib,
      trips: {
        trip000001: {
          ...trip,
          days: trip.days.map((day, i) => ({
            ...day,
            stops: {
              ...day.stops,
              value: i === 0 ? [...day.stops.value, ...trip.days[1]!.stops.value] : [],
            },
          })),
        },
      },
    };
    const doc = buildLiveTripDoc(
      changed,
      'trip000001',
      () => ({
        durationS: 60,
        distanceM: 10,
        tollFare: null,
        status: 'routed',
        queriedAt: opts.createdAt,
        path: Array.from({ length: 15000 }, () => [127, 37] as [number, number]),
      }),
      opts,
    )!;
    expect(
      doc.share.trips[0]!.days.flatMap((d) => d.legs).reduce((n, l) => n + l.path.length, 0),
    ).toBeLessThanOrEqual(10000);
  });
  it('큰 문서는 경로선을 빼고 그래도 크면 포기하며 입력을 바꾸지 않는다', () => {
    const d = buildLiveDoc();
    expect(fitLiveDoc(d)).toBe(d);
    d.share.trips[0]!.days[0]!.legs = [
      {
        from: d.share.places[0]!.id,
        to: d.share.places[1]!.id,
        mode: 'car',
        durationS: 1,
        distanceM: 1,
        tollFare: null,
        status: 'routed',
        queriedAt: opts.createdAt,
        path: Array.from({ length: 50000 }, () => [127.123456, 37.123456]),
      },
    ];
    expect(liveDocBytes(d)).toBeGreaterThan(LIVE_DOC_MAX_BYTES);
    const result = fitLiveDoc(d)!;
    expect(result.share.trips[0]!.days[0]!.legs[0]!.path).toEqual([]);
    expect(d.share.trips[0]!.days[0]!.legs[0]!.path).toHaveLength(50000);
    d.share.places[0]!.memo = '가'.repeat(LIVE_DOC_MAX_BYTES);
    expect(fitLiveDoc(d)).toBeNull();
  });
  it('지문은 경로 조회 시각·시간·경로선·만든 시각을 무시한다', async () => {
    const a = buildLiveDoc();
    a.share.trips[0]!.days[0]!.legs = [
      {
        from: 'place00001',
        to: 'place00002',
        mode: 'car',
        durationS: 1,
        distanceM: 1,
        tollFare: null,
        status: 'routed',
        queriedAt: null,
        path: [],
      },
    ];
    const b = structuredClone(a);
    b.share.createdAt = '2026-12-01T00:00:00Z';
    Object.assign(b.share.trips[0]!.days[0]!.legs[0]!, {
      durationS: 500,
      distanceM: 900,
      status: 'routed',
      queriedAt: opts.createdAt,
      path: [[127, 37]],
    });
    expect(await liveEditKey(a)).toBe(await liveEditKey(b));
  });
  it('추정에서 받은 경로로 바뀌면 지문이 바뀌고 다시 받은 경로는 무시한다', async () => {
    const doc = buildLiveDoc();
    doc.share.trips[0]!.days[0]!.legs = [
      {
        from: 'place00001',
        to: 'place00002',
        mode: 'car',
        durationS: 0,
        distanceM: 0,
        tollFare: null,
        status: 'estimated',
        queriedAt: null,
        path: [],
      },
    ];
    const estimated = await liveEditKey(doc);
    doc.share.trips[0]!.days[0]!.legs[0]!.status = 'routed';
    const routed = await liveEditKey(doc);
    expect(routed).not.toBe(estimated);
    Object.assign(doc.share.trips[0]!.days[0]!.legs[0]!, {
      durationS: 500,
      distanceM: 900,
      queriedAt: opts.createdAt,
      path: [[127, 37]],
    });
    expect(await liveEditKey(doc)).toBe(routed);
  });
  it('제목·장소 이름·Stop 순서가 달라지면 지문도 바뀐다', async () => {
    const a = buildLiveDoc(),
      key = await liveEditKey(a);
    for (const mutate of [
      (d: typeof a) => {
        d.share.title = '변경';
      },
      (d: typeof a) => {
        d.share.places[0]!.name = '변경';
      },
      (d: typeof a) => {
        d.ids.stops.reverse();
      },
    ]) {
      const d = structuredClone(a);
      mutate(d);
      expect(await liveEditKey(d)).not.toBe(key);
    }
  });
});

describe('합류용 계획 지문', () => {
  function docWithLeg() {
    const doc = buildLiveDoc();
    doc.share.trips[0]!.days[0]!.legs = [
      {
        from: 'place00001',
        to: 'place00002',
        mode: 'car',
        durationS: 600,
        distanceM: 1000,
        tollFare: 100,
        status: 'routed',
        queriedAt: opts.createdAt,
        path: [[127, 37]],
      },
    ];
    return doc;
  }
  it('경로의 시간·거리·요금·상태·조회 시각·경로선과 만든 시각만 무시한다', async () => {
    const a = docWithLeg(),
      b = structuredClone(a);
    b.share.createdAt = '2026-12-01T00:00:00Z';
    Object.assign(b.share.trips[0]!.days[0]!.legs[0]!, ESTIMATE_ONLY({} as never));
    expect(await livePlanKey(a)).toBe(await livePlanKey(b));
    expect(await liveEditKey(a)).not.toBe(await liveEditKey(b));
  });
  const changes: [string, (d: ReturnType<typeof buildLiveDoc>) => void][] = [
    [
      '공유 제목',
      (d) => {
        d.share.title = '다른 제목';
      },
    ],
    [
      '여행 제목',
      (d) => {
        d.share.trips[0]!.title = '다른 제목';
      },
    ],
    [
      '시작일',
      (d) => {
        d.share.trips[0]!.startDate = '2026-12-08';
      },
    ],
    [
      '종료일',
      (d) => {
        d.share.trips[0]!.endDate = '2026-12-11';
      },
    ],
    [
      '출발지',
      (d) => {
        d.share.trips[0]!.originId = 'place00002';
      },
    ],
    [
      '후보',
      (d) => {
        d.share.trips[0]!.candidateIds = ['place00002'];
      },
    ],
    [
      '체류 시간',
      (d) => {
        d.share.trips[0]!.days[0]!.stops[0]!.stayMin = 90;
      },
    ],
    [
      '고정 시각',
      (d) => {
        d.share.trips[0]!.days[0]!.stops[0]!.fixedTime = '11:00';
      },
    ],
    [
      'Stop 메모',
      (d) => {
        d.share.trips[0]!.days[0]!.stops[0]!.note = '새 메모';
      },
    ],
    [
      'Stop 장소',
      (d) => {
        d.share.trips[0]!.days[0]!.stops[0]!.placeId = 'place00002';
      },
    ],
    [
      'Stop id',
      (d) => {
        d.ids.stops[0]![0] = 'newstop1';
      },
    ],
    [
      'Day id',
      (d) => {
        d.ids.days[0] = 'newday01';
      },
    ],
    [
      '출발 시각',
      (d) => {
        d.share.trips[0]!.days[0]!.startTime = '08:00';
      },
    ],
    [
      '숙소',
      (d) => {
        d.share.trips[0]!.days[0]!.lodgingId = 'place00002';
      },
    ],
    [
      '구간 수단 지정',
      (d) => {
        d.share.trips[0]!.legModes['place00001>place00002'] = 'walk';
      },
    ],
    [
      '구간 출발',
      (d) => {
        d.share.trips[0]!.days[0]!.legs[0]!.from = 'place00002';
      },
    ],
    [
      '구간 도착',
      (d) => {
        d.share.trips[0]!.days[0]!.legs[0]!.to = 'place00001';
      },
    ],
    [
      '구간 수단',
      (d) => {
        d.share.trips[0]!.days[0]!.legs[0]!.mode = 'walk';
      },
    ],
    [
      '공개 옵션',
      (d) => {
        d.options.includeCandidates = false;
      },
    ],
    [
      '장소 정보',
      (d) => {
        d.share.places[0]!.name = '새 이름';
      },
    ],
  ];
  it.each(changes)('%s 수정은 지문을 바꾸어 미공개 변경으로 남긴다', async (_name, change) => {
    const a = docWithLeg(),
      b = structuredClone(a);
    change(b);
    expect(await livePlanKey(a)).not.toBe(await livePlanKey(b));
  });
});
