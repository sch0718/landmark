import { describe, expect, it } from 'vitest';
import {
  stableStringify,
  type AnyItem,
  type ItemDocOf,
  type ItemKind,
} from 'src/domain/library-sync/items';
import { mergeDeletion, mergeItem } from 'src/domain/library-sync/merge';
import type { FolderLink, Label, Place } from 'src/schema/library';
import type { Day, Stop, Trip } from 'src/schema/trip';
import { buildMeeting } from '../../../fixtures/builders';

const T0 = '2026-10-03T00:00:00.000Z';
const T1 = '2026-10-04T00:00:00.000Z';
const T2 = '2026-10-05T00:00:00.000Z';
const T3 = '2026-10-06T00:00:00.000Z';
const f = <T>(value: T, updatedAt = T0) => ({ value, updatedAt });
const place = (overrides: Partial<Place> = {}): Place => ({
  id: 'place00001',
  source: { kind: 'pin' },
  name: f('장소'),
  address: '주소',
  lng: 127,
  lat: 37,
  category: f(null),
  labelIds: f([]),
  memo: f('메모'),
  saved: f(true),
  createdAt: T0,
  deletedAt: null,
  ...overrides,
});
const label = (overrides: Partial<Label> = {}): Label => ({
  id: 'label001',
  name: f('라벨'),
  color: f('red'),
  icon: f('star'),
  order: f(0),
  createdAt: T0,
  deletedAt: null,
  ...overrides,
});
const folder = (overrides: Partial<FolderLink> = {}): FolderLink => ({
  shareId: 'Share01',
  name: f('폴더'),
  labelId: f('label001'),
  seenSids: f(['123']),
  checkedAt: T0,
  createdAt: T0,
  deletedAt: null,
  ...overrides,
});
const stop = (placeId = 'place00001'): Stop => ({
  id: 'stop0001',
  placeId,
  stayMin: null,
  fixedTime: null,
  note: '',
});
const day = (overrides: Partial<Day> = {}): Day => ({
  stops: f([]),
  lodging: f(null),
  startTime: f('09:00'),
  ...overrides,
});
const trip = (overrides: Partial<Trip> = {}): Trip => ({
  id: 'trip000001',
  title: f('여행'),
  startDate: f('2026-11-01'),
  endDate: f('2026-11-01'),
  origin: f(null),
  candidates: f([]),
  days: [day()],
  legModes: f({}),
  createdAt: T0,
  deletedAt: null,
  ...overrides,
});

const pairs: { name: string; kind: ItemKind; a: AnyItem; b: AnyItem }[] = [
  {
    name: '메모 시각',
    kind: 'place',
    a: place({ memo: f('이전', T1) }),
    b: place({ memo: f('최근', T2) }),
  },
  {
    name: '메모 동시각',
    kind: 'place',
    a: place({ memo: f('가', T1) }),
    b: place({ memo: f('나', T1) }),
  },
  {
    name: '방문일 한쪽만',
    kind: 'place',
    a: place(),
    b: place({ visitedOn: f('2026-10-03', T1) }),
  },
  {
    name: '후기 양쪽',
    kind: 'place',
    a: place({ review: f('예전', T1) }),
    b: place({ review: f('최근', T2) }),
  },
  {
    name: '이모지 지우기',
    kind: 'label',
    a: label({ emoji: f('⭐', T1) }),
    b: label({ emoji: f(null, T2) }),
  },
  { name: '이모지 한쪽만', kind: 'label', a: label(), b: label({ emoji: f('⭐', T1) }) },
  { name: '같은 값 다른 시각', kind: 'place', a: place(), b: place({ memo: f('메모', T2) }) },
  {
    name: '불변값 생성일',
    kind: 'place',
    a: place({ createdAt: T1, address: '새 주소', lng: 128, lat: 38 }),
    b: place(),
  },
  {
    name: '불변값 동시각',
    kind: 'place',
    a: place({ address: '가', lng: 128 }),
    b: place({ address: '나', lng: 129 }),
  },
  {
    name: '폴더 필드',
    kind: 'folder',
    a: folder({ name: f('수정', T1) }),
    b: folder({ checkedAt: T2, seenSids: f(['123', '456'], T2) }),
  },
  { name: '둘 다 살아 있음', kind: 'place', a: place(), b: place({ memo: f('새', T2) }) },
  { name: '둘 다 묘비', kind: 'place', a: place({ deletedAt: T1 }), b: place({ deletedAt: T2 }) },
  {
    name: '묘비가 늦음',
    kind: 'place',
    a: place({ deletedAt: T2 }),
    b: place({ memo: f('새', T1) }),
  },
  {
    name: '생존이 늦음',
    kind: 'place',
    a: place({ deletedAt: T1 }),
    b: place({ memo: f('새', T2) }),
  },
  {
    name: '같은 시각 묘비',
    kind: 'place',
    a: place({ deletedAt: T2 }),
    b: place({ memo: f('새', T2) }),
  },
  {
    name: '같은 날 수 Day 병합',
    kind: 'trip',
    a: trip({ days: [day({ stops: f([stop()], T1) })] }),
    b: trip({ days: [day({ lodging: f('place00002', T2), startTime: f('10:00', T2) })] }),
  },
  {
    name: '날 수 다름 날짜 승자',
    kind: 'trip',
    a: trip({ title: f('제목', T3) }),
    b: trip({ startDate: f('2026-11-01', T1), endDate: f('2026-11-02', T1), days: [day(), day()] }),
  },
  {
    name: '날짜 동시각',
    kind: 'trip',
    a: trip(),
    b: trip({ startDate: f('2026-11-02'), endDate: f('2026-11-03'), days: [day(), day()] }),
  },
  {
    name: '여행 관계 위반 전체 선택',
    kind: 'trip',
    a: trip({ candidates: f(['place00001'], T1) }),
    b: trip({ title: f('최신 여행', T3), days: [day({ stops: f([stop()], T2) })] }),
  },
  {
    name: '전체 선택 동시각',
    kind: 'trip',
    a: trip({ title: f('가', T2), candidates: f(['place00001'], T1) }),
    b: trip({ title: f('나', T2), days: [day({ stops: f([stop()], T1) })] }),
  },
  {
    name: '약속 관계 위반 전체 선택',
    kind: 'meeting',
    a: buildMeeting({ participants: f([], T2) }),
    b: buildMeeting({
      replies: f({ person01: { likes: ['choice01'], sentAt: T3, receivedAt: T3 } }, T3),
    }),
  },
];

const named = <K extends ItemKind>(name: string, kind: K): { a: ItemDocOf[K]; b: ItemDocOf[K] } => {
  const pair = pairs.find((p) => p.name === name && p.kind === kind)!;
  return { a: pair.a as ItemDocOf[K], b: pair.b as ItemDocOf[K] };
};

describe('필드 병합', () => {
  it('늦은 메모와 진 쪽 경로/시각을 남긴다', () => {
    const { a, b } = named('메모 시각', 'place');
    const result = mergeItem('place', a, b);
    expect(result.doc.memo).toBe(b.memo);
    expect(result.losers).toEqual([{ path: 'memo', side: 'a', value: '이전', updatedAt: T1 }]);
    expect(mergeItem('place', b, a).losers[0]?.side).toBe('b');
    expect(a.memo.value).toBe('이전');
  });

  it('동시각은 사전순으로 큰 값을 고른다', () => {
    const { a, b } = named('메모 동시각', 'place');
    expect(mergeItem('place', a, b).doc.memo.value).toBe('나');
  });

  it('방문일/후기가 한쪽에만 있으면 그대로 보존한다', () => {
    const { a, b } = named('방문일 한쪽만', 'place');
    const result = mergeItem('place', a, b);
    expect(result.doc.visitedOn).toBe(b.visitedOn);
    expect(result.losers).toEqual([]);
    expect(mergeItem('place', a, place({ review: f('후기', T1) })).doc.review).toEqual(
      f('후기', T1),
    );
  });

  it('후기 양쪽은 LWW로 고르고 진 값을 남긴다', () => {
    const { a, b } = named('후기 양쪽', 'place');
    expect(mergeItem('place', a, b)).toMatchObject({
      doc: { review: b.review },
      losers: [{ path: 'review', value: '예전', side: 'a', updatedAt: T1 }],
    });
  });

  it('라벨 이모지 null도 LWW 값이고 한쪽만 있어도 보존한다', () => {
    const { a, b } = named('이모지 지우기', 'label');
    expect(mergeItem('label', a, b).doc.emoji).toEqual(f(null, T2));
    const optional = named('이모지 한쪽만', 'label');
    expect(mergeItem('label', optional.a, optional.b).doc.emoji).toBe(optional.b.emoji);
  });

  it('값이 같으면 시각이 달라도 진 값으로 기록하지 않는다', () => {
    const { a, b } = named('같은 값 다른 시각', 'place');
    expect(mergeItem('place', a, b).losers).toEqual([]);
    expect(mergeItem('place', a, b).doc.memo.updatedAt).toBe(T2);
  });

  it('불변 위치 정보는 이른 생성일의 묶음을 유지한다', () => {
    const { a, b } = named('불변값 생성일', 'place');
    const result = mergeItem('place', a, b).doc;
    expect([result.source, result.address, result.lng, result.lat, result.createdAt]).toEqual([
      b.source,
      b.address,
      b.lng,
      b.lat,
      T0,
    ]);
  });

  it('불변값 생성일 동률은 묶음 직렬화의 사전순으로 고른다', () => {
    const { a, b } = named('불변값 동시각', 'place');
    const result = mergeItem('place', a, b).doc;
    expect([result.address, result.lng]).toEqual(['나', 129]);
  });

  it('폴더 필드는 합치고 checkedAt은 늦은 것을 고른다', () => {
    const { a, b } = named('폴더 필드', 'folder');
    expect(mergeItem('folder', a, b).doc).toMatchObject({
      name: a.name,
      seenSids: b.seenSids,
      checkedAt: T2,
    });
  });

  it('스키마 필드 순서와 a의 키 순서로 결과를 만든다', () => {
    const a = place({ visitedOn: f(null), review: f('') });
    const result = mergeItem('place', a, place({ review: f('새', T2) })).doc;
    expect(Object.keys(result)).toEqual(Object.keys(a));
  });
});

describe('삭제 병합', () => {
  it('둘 다 살아 있으면 null, 둘 다 묘비면 늦은 삭제일이다', () => {
    expect(mergeDeletion(place(), place())).toBeNull();
    expect(mergeDeletion(place({ deletedAt: T1 }), place({ deletedAt: T2 }))).toBe(T2);
  });

  it.each([false, true])('baseDeleted=%s와 달라진 쪽을 양방향으로 선택한다', (baseDeleted) => {
    const a = place({ deletedAt: T2 });
    const b = place();
    const expected = baseDeleted ? null : T2;
    expect(mergeDeletion(a, b, baseDeleted)).toBe(expected);
    expect(mergeDeletion(b, a, baseDeleted)).toBe(expected);
    expect(mergeItem('place', a, b, { baseDeleted }).doc.deletedAt).toBe(expected);
    expect(mergeItem('place', b, a, { baseDeleted }).doc.deletedAt).toBe(expected);
    const merged = mergeItem('place', a, b, { baseDeleted }).doc;
    expect(stableStringify(merged)).toBe(
      stableStringify(mergeItem('place', b, a, { baseDeleted }).doc),
    );
    expect(mergeItem('place', merged, merged, { baseDeleted }).losers).toEqual([]);
    expect(stableStringify(mergeItem('place', merged, merged, { baseDeleted }).doc)).toBe(
      stableStringify(merged),
    );
    expect(stableStringify(mergeItem('place', a, merged, { baseDeleted }).doc)).toBe(
      stableStringify(merged),
    );
  });

  it.each([
    ['묘비가 늦음', T2],
    ['생존이 늦음', null],
    ['같은 시각 묘비', T2],
  ])('base가 없으면 %s 규칙을 따른다', (name, expected) => {
    const { a, b } = named(name!, 'place');
    expect(mergeDeletion(a, b)).toBe(expected);
    expect(mergeDeletion(b, a)).toBe(expected);
  });
});

describe('여행과 약속 관계 병합', () => {
  it('같은 날 수면 Day별 stops, lodging, startTime을 합친다', () => {
    const { a, b } = named('같은 날 수 Day 병합', 'trip');
    const result = mergeItem('trip', a, b);
    expect(result.doc.days).toEqual([
      day({
        stops: a.days[0]!.stops,
        lodging: b.days[0]!.lodging,
        startTime: b.days[0]!.startTime,
      }),
    ]);
    expect(result.losers.map((loser) => loser.path)).toEqual([
      'days.0.stops',
      'days.0.lodging',
      'days.0.startTime',
    ]);
    expect(result.whole).toBeUndefined();
  });

  it('날 수가 다르면 날짜 승자의 days 전체와 다른 필드 LWW를 쓴다', () => {
    const { a, b } = named('날 수 다름 날짜 승자', 'trip');
    const result = mergeItem('trip', a, b);
    expect(result.doc.days).toEqual(b.days);
    expect(result.doc.startDate).toBe(b.startDate);
    expect(result.doc.endDate).toBe(b.endDate);
    expect(result.doc.title).toBe(a.title);
    expect(result.losers.find((loser) => loser.path === 'days')).toMatchObject({
      side: 'a',
      value: a.days,
      updatedAt: T0,
    });
  });

  it('날짜 시각 동률은 날짜/날 수 문자열로 결정한다', () => {
    const { a, b } = named('날짜 동시각', 'trip');
    expect(mergeItem('trip', a, b).doc.days).toEqual(b.days);
    expect(mergeItem('trip', a, b).doc.startDate).toBe(b.startDate);
  });

  it('후보와 Stop이 중복되면 마지막 변경 문서를 전체 선택하고 진 쪽을 남긴다', () => {
    const { a, b } = named('여행 관계 위반 전체 선택', 'trip');
    const result = mergeItem('trip', a, b);
    expect(result).toEqual({ doc: b, losers: [], whole: 'a' });
    expect(mergeItem('trip', b, a).whole).toBe('b');
  });

  it('전체 선택 동시각은 문서 문자열로 결정하고 삭제 규칙을 별도로 적용한다', () => {
    const { a, b } = named('전체 선택 동시각', 'trip');
    const winner = stableStringify(a) > stableStringify(b) ? a : b;
    expect(mergeItem('trip', a, b).doc).toEqual(winner);
    expect(
      mergeItem('trip', { ...a, deletedAt: T3 }, b, { baseDeleted: true }).doc.deletedAt,
    ).toBeNull();
  });

  it('참석자 삭제와 답장이 충돌하면 약속 전체를 선택한다', () => {
    const { a, b } = named('약속 관계 위반 전체 선택', 'meeting');
    expect(mergeItem('meeting', a, b)).toEqual({ doc: b, losers: [], whole: 'a' });
  });
});

describe('모든 병합 쌍의 성질', () => {
  for (const { name, kind, a, b } of pairs) {
    it(`${name}: 교환법칙, 멱등, 흡수`, () => {
      const result = mergeItem(kind, a, b).doc;
      expect(stableStringify(result)).toBe(stableStringify(mergeItem(kind, b, a).doc));
      const same = mergeItem(kind, result, result);
      expect(stableStringify(same.doc)).toBe(stableStringify(result));
      expect(same.losers).toEqual([]);
      expect(stableStringify(mergeItem(kind, a, result).doc)).toBe(stableStringify(result));
    });
  }
});
