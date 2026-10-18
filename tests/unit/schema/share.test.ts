import { describe, expect, it } from 'vitest';
import { safeParse } from 'src/schema/parse';
import { ShareDocSchema, ShareDocV2Schema } from 'src/schema/share';

/* eslint-disable @typescript-eslint/no-explicit-any -- 일부러 틀린 문서를 만드는 시험이라 느슨하게 둔다 */
const OPTS = { onExcessProperty: 'error' } as const;

function v1(): Record<string, unknown> {
  return {
    format: 'tripmap-share',
    version: 1,
    title: '강릉',
    createdAt: '2026-10-16T05:00:00.000Z',
    labels: [{ id: 'l1', name: '맛집', color: 'red', order: 0 }],
    places: [
      { id: 'p1', name: '테라로사', address: '강릉', lng: 128.9, lat: 37.7, labelIds: ['l1'] },
    ],
  };
}

function v2(): any {
  const doc: any = v1();
  doc.version = 2;
  doc.places[0].review = '맛있어요';
  doc.trips = [
    {
      title: '강릉 1박',
      startDate: '2026-10-24',
      endDate: '2026-10-24',
      originId: null,
      candidateIds: [],
      legModes: {},
      days: [
        {
          startTime: '09:00',
          lodgingId: null,
          stops: [{ placeId: 'p1', stayMin: 60, fixedTime: null, note: '점심' }],
          legs: [],
        },
      ],
    },
  ];
  return doc;
}

describe('ShareDocSchema (v1)', () => {
  it('정상 v1 문서는 통과', () => {
    expect(safeParse(ShareDocSchema, v1(), OPTS).success).toBe(true);
  });

  it('version 2 문서는 거절', () => {
    expect(safeParse(ShareDocSchema, v2(), OPTS).success).toBe(false);
  });

  it('v1 장소의 review는 모르는 필드로 거절', () => {
    const d = v1() as any;
    d.places[0].review = 'x';
    expect(safeParse(ShareDocSchema, d, OPTS).success).toBe(false);
  });
});

describe('ShareDocV2Schema', () => {
  it('정상 v2 문서는 통과', () => {
    expect(safeParse(ShareDocV2Schema, v2(), OPTS).success).toBe(true);
  });

  it('review 없이도 통과', () => {
    const d = v2();
    delete d.places[0].review;
    expect(safeParse(ShareDocV2Schema, d, OPTS).success).toBe(true);
  });

  it('모르는 필드를 거절', () => {
    const a = v2();
    a.places[0].foo = 1;
    expect(safeParse(ShareDocV2Schema, a, OPTS).success).toBe(false);
    const b = v2();
    b.trips[0].id = 'abc';
    expect(safeParse(ShareDocV2Schema, b, OPTS).success).toBe(false);
  });

  it('review 140자는 통과, 141자는 거절', () => {
    const a = v2();
    a.places[0].review = 'a'.repeat(140);
    expect(safeParse(ShareDocV2Schema, a, OPTS).success).toBe(true);
    a.places[0].review = 'a'.repeat(141);
    expect(safeParse(ShareDocV2Schema, a, OPTS).success).toBe(false);
  });

  it('trips는 정확히 1개', () => {
    const a = v2();
    a.trips = [];
    expect(safeParse(ShareDocV2Schema, a, OPTS).success).toBe(false);
    const b = v2();
    b.trips = [b.trips[0], structuredClone(b.trips[0])];
    expect(safeParse(ShareDocV2Schema, b, OPTS).success).toBe(false);
  });

  it('v1 문서는 거절', () => {
    expect(safeParse(ShareDocV2Schema, v1(), OPTS).success).toBe(false);
  });

  it('필드 값을 검사', () => {
    const cases: Array<(d: any) => void> = [
      (d) => (d.trips[0].startDate = '2026-02-30'),
      (d) => (d.trips[0].days[0].startTime = '9:00'),
      (d) => (d.trips[0].days[0].stops[0].fixedTime = '25:00'),
      (d) => (d.trips[0].days[0].stops[0].stayMin = 1441),
      (d) => (d.trips[0].days[0].stops[0].stayMin = 1.5),
      (d) => (d.trips[0].days[0].stops[0].note = 'a'.repeat(501)),
      (d) => (d.trips[0].legModes = { 'a>b': 'bus' }),
    ];
    for (const edit of cases) {
      const d = v2();
      edit(d);
      expect(safeParse(ShareDocV2Schema, d, OPTS).success).toBe(false);
    }
  });

  it('구간을 검사', () => {
    const leg = {
      from: 'p1',
      to: 'p1',
      mode: 'car',
      durationS: 1,
      distanceM: 1,
      tollFare: null,
      status: 'routed',
      queriedAt: '2026-10-16T04:58:00.000Z',
      path: [[128.9, 37.7]],
    };
    const ok = v2();
    ok.trips[0].days[0].legs = [leg];
    expect(safeParse(ShareDocV2Schema, ok, OPTS).success).toBe(true);
    for (const bad of [
      { ...leg, status: 'weird' },
      { ...leg, queriedAt: '어제' },
      { ...leg, path: [[128.9]] },
      { ...leg, path: [[128.9, Number.POSITIVE_INFINITY]] },
      { ...leg, extra: 1 },
    ]) {
      const d = v2();
      d.trips[0].days[0].legs = [bad];
      expect(safeParse(ShareDocV2Schema, d, OPTS).success).toBe(false);
    }
  });
});
