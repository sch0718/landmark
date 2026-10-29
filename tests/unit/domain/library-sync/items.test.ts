import { describe, expect, it } from 'vitest';
import {
  decodeItem,
  getItem,
  hashItem,
  isDeleted,
  ITEM_DOC_MAX_CHARS,
  ITEM_KINDS,
  itemKey,
  itemLabel,
  lastTouched,
  listItems,
  parseItemKey,
  putItems,
  removeItems,
  stableStringify,
  tripRefs,
} from 'src/domain/library-sync/items';
import type { FolderLink, Label, Library, Place } from 'src/schema/library';
import type { Day, Stop, Trip } from 'src/schema/trip';
import { buildMeeting } from '../../../fixtures/builders';

const T0 = '2026-10-03T00:00:00.000Z';
const T1 = '2026-10-04T00:00:00.000Z';
const T2 = '2026-10-05T00:00:00.000Z';
const f = <T>(value: T, updatedAt = T0) => ({ value, updatedAt });
const place = (id = 'place00001'): Place => ({
  id,
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
});
const label = (id = 'label001'): Label => ({
  id,
  name: f('라벨'),
  color: f('red'),
  icon: f('star'),
  order: f(0),
  createdAt: T0,
  deletedAt: null,
});
const folder = (): FolderLink => ({
  shareId: 'Share01',
  name: f('폴더'),
  labelId: f('label001'),
  seenSids: f(['123']),
  checkedAt: T1,
  createdAt: T0,
  deletedAt: null,
});
const stop = (id = 'stop0001', placeId = 'place00001'): Stop => ({
  id,
  placeId,
  stayMin: null,
  fixedTime: null,
  note: '',
});
const day = (): Day => ({ stops: f([]), lodging: f(null), startTime: f('09:00') });
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
const library = (): Library => ({ schemaVersion: 2, places: {}, labels: {}, trips: {} });

describe('동기화 항목', () => {
  it('종류와 id 순서대로 묘비와 shareId 폴더를 나열한다', () => {
    const a = place('place00001');
    const b = { ...place('place00002'), deletedAt: T1 };
    const lib: Library = {
      ...library(),
      places: { [b.id]: b, [a.id]: a },
      labels: { label002: label('label002'), label001: label() },
      folders: { Share01: folder() },
      trips: { trip000001: trip() },
      meetings: { meeting001: buildMeeting() },
    };
    expect(ITEM_KINDS).toEqual(['label', 'place', 'folder', 'trip', 'meeting']);
    expect(listItems(lib).map((entry) => entry.key)).toEqual([
      'label:label001',
      'label:label002',
      'place:place00001',
      'place:place00002',
      'folder:Share01',
      'trip:trip000001',
      'meeting:meeting001',
    ]);
    expect(listItems(lib)[3]).toEqual({ key: 'place:place00002', kind: 'place', id: b.id, doc: b });
    expect(listItems(library())).toEqual([]);
  });

  it('항목 키를 왕복하고 모르는 종류와 빈 id를 거절한다', () => {
    for (const kind of ITEM_KINDS) {
      expect(parseItemKey(itemKey(kind, 'id:part'))).toEqual({ kind, id: 'id:part' });
    }
    for (const key of ['x:1', 'place:', 'place', ':id', 'toString:id']) {
      expect(parseItemKey(key)).toBeNull();
    }
  });

  it('빈 입력과 같은 문서는 참조를 유지하고 바뀐 컬렉션만 복사한다', () => {
    const lib = library();
    expect(putItems(lib, [])).toBe(lib);
    const p = place();
    const result = putItems(lib, [{ kind: 'place', id: p.id, doc: p }]);
    expect(result).not.toBe(lib);
    expect(result.places).not.toBe(lib.places);
    expect(result.labels).toBe(lib.labels);
    expect(result.trips).toBe(lib.trips);
    expect(getItem(result, 'place', p.id)).toBe(p);
    expect(getItem(lib, 'place', p.id)).toBeUndefined();
    expect(putItems(result, [{ kind: 'place', id: p.id, doc: p }])).toBe(result);
  });

  it('없는 폴더와 약속 컬렉션을 만든다', () => {
    const lib = putItems(library(), [
      { kind: 'folder', id: 'Share01', doc: folder() },
      { kind: 'meeting', id: 'meeting001', doc: buildMeeting() },
    ]);
    expect(getItem(lib, 'folder', 'Share01')).toEqual(folder());
    expect(getItem(lib, 'meeting', 'meeting001')).toEqual(buildMeeting());
    expect(getItem(library(), 'folder', 'Share01')).toBeUndefined();
  });

  it('되돌릴 때 지정 항목만 제거하고 원본은 유지한다', () => {
    const p = place();
    const lib = putItems(library(), [{ kind: 'place', id: p.id, doc: p }]);
    expect(removeItems(lib, [])).toBe(lib);
    expect(removeItems(lib, ['folder:missing'])).toBe(lib);
    const result = removeItems(lib, ['place:place00001', 'place:place00001']);
    expect(result.places).toEqual({});
    expect(lib.places[p.id]).toBe(p);
    expect(result.labels).toBe(lib.labels);
  });

  it('객체 키를 재귀 정렬하고 배열 순서와 JSON의 undefined 처리를 유지한다', () => {
    expect(stableStringify({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}');
    expect(stableStringify({ z: undefined, a: [{ b: 2, a: 1 }, undefined, 3] })).toBe(
      '{"a":[{"a":1,"b":2},null,3]}',
    );
  });

  it('키 순서가 달라도 해시가 같고 메모 한 글자 변경은 다르다', () => {
    const p = place();
    expect(hashItem(p)).toBe(hashItem(Object.fromEntries(Object.entries(p).reverse())));
    expect(hashItem(p)).not.toBe(hashItem({ ...p, memo: f('메모!') }));
  });

  it('종류별 이름과 삭제 여부를 읽는다', () => {
    expect(itemLabel('place', place())).toBe('장소');
    expect(itemLabel('label', label())).toBe('라벨');
    expect(itemLabel('folder', folder())).toBe('폴더');
    expect(itemLabel('trip', trip())).toBe('여행');
    expect(itemLabel('meeting', buildMeeting())).toBe('친구 모임');
    expect(isDeleted(place())).toBe(false);
    expect(isDeleted({ ...place(), deletedAt: T1 })).toBe(true);
  });

  it('Day Stop 필드와 묘비, 생성일, 폴더 확인일을 재귀로 살핀다', () => {
    expect(lastTouched(trip({ days: [{ ...day(), stops: f([stop()], T2) }] }))).toBe(T2);
    expect(lastTouched({ ...place(), deletedAt: T2 })).toBe(T2);
    expect(lastTouched({ ...place(), createdAt: T2 })).toBe(T2);
    expect(lastTouched(folder())).toBe(T1);
  });

  it('여행의 모든 장소 참조를 중복 없이 정렬한다', () => {
    expect(
      tripRefs(
        trip({
          origin: f('place00003'),
          candidates: f(['place00002', 'place00001']),
          days: [{ ...day(), stops: f([stop()]), lodging: f('place00004') }],
        }),
      ),
    ).toEqual(['place00001', 'place00002', 'place00003', 'place00004']);
    expect(tripRefs(trip())).toEqual([]);
  });
});

describe('항목 문서 검사', () => {
  it('종류별 정상 문서를 읽고 알 수 없는 속성은 기본 스키마 옵션대로 버린다', () => {
    const pairs = [
      ['place', 'place00001', place()],
      ['label', 'label001', label()],
      ['folder', 'Share01', folder()],
      ['trip', 'trip000001', trip({ candidates: f(['place00001']) })],
      ['meeting', 'meeting001', buildMeeting()],
    ] as const;
    for (const [kind, id, doc] of pairs) {
      expect(decodeItem(kind, id, { ...doc, extra: true })).toEqual({ ok: true, doc });
      expect(decodeItem(kind, 'other', doc)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('스키마에 맞지 않는 문서를 거절한다', () => {
    for (const value of [null, {}, { ...place(), lat: 999 }]) {
      expect(decodeItem('place', 'place00001', value)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('500자 Stop 메모 400개가 든 여행은 스키마보다 크기부터 거절한다', () => {
    const large = trip({
      days: [
        {
          ...day(),
          stops: f(Array.from({ length: 400 }, () => ({ ...stop(), note: '가'.repeat(500) }))),
        },
      ],
    });
    expect(stableStringify(large).length).toBeGreaterThan(ITEM_DOC_MAX_CHARS);
    expect(decodeItem('trip', large.id, large)).toEqual({ ok: false, reason: 'too-large' });
  });

  it('날 수가 기간과 다른 여행과 후보/Stop 중복을 거절한다', () => {
    expect(decodeItem('trip', 'trip000001', trip({ endDate: f('2026-11-02') }))).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(
      decodeItem(
        'trip',
        'trip000001',
        trip({ candidates: f(['place00001']), days: [{ ...day(), stops: f([stop()]) }] }),
      ),
    ).toEqual({ ok: false, reason: 'invalid' });
  });

  it('참석자 id가 중복된 약속을 거절한다', () => {
    const meeting = buildMeeting();
    const invalid = {
      ...meeting,
      participants: f([meeting.participants.value[0]!, meeting.participants.value[0]!]),
    };
    expect(decodeItem('meeting', meeting.id, invalid)).toEqual({ ok: false, reason: 'invalid' });
  });
});
