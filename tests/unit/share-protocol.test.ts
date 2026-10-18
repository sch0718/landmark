import { describe, expect, it } from 'vitest';
import {
  envelope,
  MAP_DRAW_LIMITS,
  parseFromMap,
  parseToMap,
  SHARE_PROTOCOL_MAX_VERSION,
  SHARE_PROTOCOL_VERSION,
  SHARE_SOURCE,
} from 'src/share-protocol';

const wrap = (msg: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  source: SHARE_SOURCE,
  v: SHARE_PROTOCOL_VERSION,
  ...msg,
  ...extra,
});

const PLACE = { id: 'p1', name: '서혜커피', lng: 127.1, lat: 37.36, color: 'teal' };

describe('상수', () => {
  it('source와 버전', () => {
    expect(SHARE_SOURCE).toBe('tripmap-share');
    expect(SHARE_PROTOCOL_VERSION).toBe(1);
  });
  it('지도가 아는 가장 높은 규약과 draw 한도', () => {
    expect(SHARE_PROTOCOL_MAX_VERSION).toBe(2);
    expect(MAP_DRAW_LIMITS).toEqual({
      pins: 2000,
      lines: 2000,
      pointsPerLine: 1000,
      pointsTotal: 60_000,
      maxDay: 29,
    });
  });
});

describe('envelope', () => {
  it('source와 v를 붙인다', () => {
    expect(envelope({ kind: 'tiles-failed' })).toEqual({
      source: 'tripmap-share',
      v: 1,
      kind: 'tiles-failed',
    });
  });
  it('봉투 버전은 기본 1, 두 번째 인자로 2', () => {
    expect(envelope({ kind: 'tiles-failed' }).v).toBe(1);
    expect(envelope({ kind: 'draw', pins: [], lines: [] }, 2)).toEqual({
      source: 'tripmap-share',
      v: 2,
      kind: 'draw',
      pins: [],
      lines: [],
    });
  });
  it('원본 메시지를 바꾸지 않는다', () => {
    const msg = { kind: 'focus', placeId: 'a' } as const;
    envelope(msg);
    expect(msg).toEqual({ kind: 'focus', placeId: 'a' });
  });
});

describe('parseToMap', () => {
  it('init 통과, 봉투 필드는 뺀다', () => {
    expect(parseToMap(wrap({ kind: 'init', places: [PLACE] }))).toEqual({
      kind: 'init',
      places: [PLACE],
    });
  });
  it('init: color null 통과, 빈 목록 통과', () => {
    expect(parseToMap(wrap({ kind: 'init', places: [{ ...PLACE, color: null }] }))).not.toBeNull();
    expect(parseToMap(wrap({ kind: 'init', places: [] }))).toEqual({ kind: 'init', places: [] });
  });
  it('init: 모르는 필드는 버린다(장소 안 포함)', () => {
    const r = parseToMap(wrap({ kind: 'init', places: [{ ...PLACE, memo: '비밀' }], junk: 1 }));
    expect(r).toEqual({ kind: 'init', places: [PLACE] });
  });
  it('focus: placeId 문자열·null 통과', () => {
    expect(parseToMap(wrap({ kind: 'focus', placeId: 'a' }))).toEqual({
      kind: 'focus',
      placeId: 'a',
    });
    expect(parseToMap(wrap({ kind: 'focus', placeId: null }))).toEqual({
      kind: 'focus',
      placeId: null,
    });
  });
  it('filter 통과', () => {
    expect(parseToMap(wrap({ kind: 'filter', placeIds: ['a', 'b'] }))).toEqual({
      kind: 'filter',
      placeIds: ['a', 'b'],
    });
  });

  it.each([
    ['source 다름', wrap({ kind: 'focus', placeId: 'a' }, { source: 'other' })],
    ['v: 3', wrap({ kind: 'focus', placeId: 'a' }, { v: 3 })],
    ['v: 1.5', wrap({ kind: 'focus', placeId: 'a' }, { v: 1.5 })],
    ['v: "2"', wrap({ kind: 'focus', placeId: 'a' }, { v: '2' })],
    ['v 없음', { source: 'tripmap-share', kind: 'focus', placeId: 'a' }],
    ['모르는 kind', wrap({ kind: 'nope' })],
    ['지도 → 파일 kind', wrap({ kind: 'ready', maxV: 1 })],
    ['places가 배열 아님', wrap({ kind: 'init', places: 'x' })],
    ['places가 없음', wrap({ kind: 'init' })],
    ['장소가 객체 아님', wrap({ kind: 'init', places: [null] })],
    ['lng 문자열', wrap({ kind: 'init', places: [{ ...PLACE, lng: '127' }] })],
    ['lat NaN', wrap({ kind: 'init', places: [{ ...PLACE, lat: NaN }] })],
    ['lng Infinity', wrap({ kind: 'init', places: [{ ...PLACE, lng: Infinity }] })],
    ['color black', wrap({ kind: 'init', places: [{ ...PLACE, color: 'black' }] })],
    ['color 없음', wrap({ kind: 'init', places: [{ id: 'p', name: 'n', lng: 1, lat: 2 }] })],
    ['name 숫자', wrap({ kind: 'init', places: [{ ...PLACE, name: 3 }] })],
    ['id 숫자', wrap({ kind: 'init', places: [{ ...PLACE, id: 3 }] })],
    ['focus placeId 숫자', wrap({ kind: 'focus', placeId: 3 })],
    ['focus placeId 없음', wrap({ kind: 'focus' })],
    ['filter placeIds 배열 아님', wrap({ kind: 'filter', placeIds: 'a' })],
    ['filter placeIds에 숫자', wrap({ kind: 'filter', placeIds: ['a', 2] })],
    ['null', null],
    ['undefined', undefined],
    ['문자열', 'tripmap-share'],
    ['배열', []],
    ['숫자', 3],
  ])('거부: %s', (_name, data) => {
    expect(parseToMap(data)).toBeNull();
  });

  it('던지지 않는다(getter가 던지는 객체)', () => {
    const evil = {
      get source(): string {
        throw new Error('boom');
      },
    };
    expect(parseToMap(evil)).toBeNull();
    expect(parseFromMap(evil)).toBeNull();
  });
});

describe('parseToMap v2', () => {
  const PIN = { id: 'p1', label: '1 서혜커피', lng: 127.1, lat: 37.36, day: 0, role: 'stop' };
  const LINE = {
    id: 'l1',
    day: 0,
    walk: false,
    path: [
      [127.1, 37.36],
      [127.2, 37.4],
    ],
  };
  const v2 = (msg: Record<string, unknown>) => wrap(msg, { v: 2 });
  const draw = (pins: unknown, lines: unknown) => v2({ kind: 'draw', pins, lines });

  it('v 2 봉투의 init·focus·filter도 통과한다', () => {
    expect(parseToMap(v2({ kind: 'init', places: [PLACE] }))).toEqual({
      kind: 'init',
      places: [PLACE],
    });
    expect(parseToMap(v2({ kind: 'focus', placeId: 'start:a' }))).toEqual({
      kind: 'focus',
      placeId: 'start:a',
    });
    expect(parseToMap(v2({ kind: 'filter', placeIds: ['a'] }))).toEqual({
      kind: 'filter',
      placeIds: ['a'],
    });
  });

  it('draw: v 2 봉투는 같은 값으로 통과한다', () => {
    expect(parseToMap(draw([PIN], [LINE]))).toEqual({ kind: 'draw', pins: [PIN], lines: [LINE] });
  });

  it('draw: 빈 목록, day null, 세 role 모두 통과한다', () => {
    expect(parseToMap(draw([], []))).toEqual({ kind: 'draw', pins: [], lines: [] });
    const pins = [
      { ...PIN, id: 'a', day: null, role: 'stop' },
      { ...PIN, id: 'b', role: 'endpoint' },
      { ...PIN, id: 'c', label: '', role: 'dim' },
    ];
    expect(parseToMap(draw(pins, []))).toEqual({ kind: 'draw', pins, lines: [] });
  });

  it('draw: 모르는 필드는 핀·선 안과 밖 모두 버린다', () => {
    const r = parseToMap(
      v2({
        kind: 'draw',
        pins: [{ ...PIN, memo: '비밀', address: '서울' }],
        lines: [{ ...LINE, duration: 3 }],
        junk: 1,
      }),
    );
    expect(r).toEqual({ kind: 'draw', pins: [PIN], lines: [LINE] });
  });

  it('draw: v 1 봉투는 버린다', () => {
    expect(parseToMap(wrap({ kind: 'draw', pins: [PIN], lines: [LINE] }))).toBeNull();
  });

  it('day 0과 29는 통과, 30·1.5·-1·문자열은 버린다', () => {
    expect(parseToMap(draw([{ ...PIN, day: 0 }], []))).not.toBeNull();
    expect(parseToMap(draw([{ ...PIN, day: 29 }], [{ ...LINE, day: 29 }]))).not.toBeNull();
    for (const day of [30, 1.5, -1, '1', NaN, undefined]) {
      expect(parseToMap(draw([{ ...PIN, day }], []))).toBeNull();
      expect(parseToMap(draw([], [{ ...LINE, day }]))).toBeNull();
    }
  });

  it('선의 day는 null일 수 없다', () => {
    expect(parseToMap(draw([], [{ ...LINE, day: null }]))).toBeNull();
  });

  it.each([
    ['role 모름', draw([{ ...PIN, role: 'x' }], [])],
    ['role 없음', draw([{ ...PIN, role: undefined }], [])],
    ['pins가 배열 아님', draw('x', [])],
    ['lines가 없음', v2({ kind: 'draw', pins: [] })],
    ['핀이 객체 아님', draw([null], [])],
    ['핀 id 숫자', draw([{ ...PIN, id: 1 }], [])],
    ['핀 label 숫자', draw([{ ...PIN, label: 1 }], [])],
    ['핀 lng NaN', draw([{ ...PIN, lng: NaN }], [])],
    ['핀 lat Infinity', draw([{ ...PIN, lat: Infinity }], [])],
    ['핀 lng 문자열', draw([{ ...PIN, lng: '127' }], [])],
    ['선 walk 문자열', draw([], [{ ...LINE, walk: 'no' }])],
    ['선 id 숫자', draw([], [{ ...LINE, id: 1 }])],
    ['선 path가 배열 아님', draw([], [{ ...LINE, path: 'x' }])],
    ['선 점이 길이 3', draw([], [{ ...LINE, path: [[1, 2, 3]] }])],
    ['선 점이 길이 1', draw([], [{ ...LINE, path: [[1]] }])],
    ['선 점 NaN', draw([], [{ ...LINE, path: [[1, NaN]] }])],
    ['선 점 문자열', draw([], [{ ...LINE, path: [['1', '2']] }])],
    ['선이 객체 아님', draw([], [3])],
  ])('draw 거부: %s', (_name, data) => {
    expect(parseToMap(data)).toBeNull();
  });

  it('draw 한도: 핀 2,000개는 통과, 2,001개는 버린다', () => {
    const pins = (n: number) => Array.from({ length: n }, (_, i) => ({ ...PIN, id: `p${i}` }));
    expect(parseToMap(draw(pins(MAP_DRAW_LIMITS.pins), []))).not.toBeNull();
    expect(parseToMap(draw(pins(MAP_DRAW_LIMITS.pins + 1), []))).toBeNull();
  });

  it('draw 한도: 선 2,000개는 통과, 2,001개는 버린다', () => {
    const lines = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ ...LINE, id: `l${i}`, path: [[127, 37]] }));
    expect(parseToMap(draw([], lines(MAP_DRAW_LIMITS.lines)))).not.toBeNull();
    expect(parseToMap(draw([], lines(MAP_DRAW_LIMITS.lines + 1)))).toBeNull();
  });

  it('draw 한도: 선 하나 1,000점은 통과, 1,001점은 버린다', () => {
    const path = (n: number) => Array.from({ length: n }, (_, i) => [127 + i * 1e-6, 37]);
    expect(
      parseToMap(draw([], [{ ...LINE, path: path(MAP_DRAW_LIMITS.pointsPerLine) }])),
    ).not.toBeNull();
    expect(
      parseToMap(draw([], [{ ...LINE, path: path(MAP_DRAW_LIMITS.pointsPerLine + 1) }])),
    ).toBeNull();
  });

  it('draw 한도: 전체 60,000점은 통과, 60,001점은 버린다', () => {
    // 선 60개 x 1,000점 = 60,000
    const line = (i: number, n: number) => ({
      ...LINE,
      id: `l${i}`,
      path: Array.from({ length: n }, () => [127, 37]),
    });
    const lines = Array.from({ length: 60 }, (_, i) => line(i, 1000));
    expect(parseToMap(draw([], lines))).not.toBeNull();
    expect(parseToMap(draw([], [...lines, line(60, 1)]))).toBeNull();
  });
});

describe('parseFromMap', () => {
  it('ready 통과', () => {
    expect(parseFromMap(wrap({ kind: 'ready', maxV: 1 }))).toEqual({ kind: 'ready', maxV: 1 });
  });
  it('select 통과', () => {
    expect(parseFromMap(wrap({ kind: 'select', placeId: 'p1' }))).toEqual({
      kind: 'select',
      placeId: 'p1',
    });
  });
  it('tiles-failed 통과, 모르는 필드는 버린다', () => {
    expect(parseFromMap(wrap({ kind: 'tiles-failed', extra: 1 }))).toEqual({
      kind: 'tiles-failed',
    });
  });

  it.each([
    ['source 다름', wrap({ kind: 'tiles-failed' }, { source: 'x' })],
    ['v: 2', wrap({ kind: 'tiles-failed' }, { v: 2 })],
    ['v: 2 ready', wrap({ kind: 'ready', maxV: 2 }, { v: 2 })],
    ['v: 2 select', wrap({ kind: 'select', placeId: 'a' }, { v: 2 })],
    ['모르는 kind', wrap({ kind: 'nope' })],
    ['파일 → 지도 kind', wrap({ kind: 'init', places: [] })],
    ['ready maxV 문자열', wrap({ kind: 'ready', maxV: '1' })],
    ['ready maxV 없음', wrap({ kind: 'ready' })],
    ['ready maxV NaN', wrap({ kind: 'ready', maxV: NaN })],
    ['select placeId 숫자', wrap({ kind: 'select', placeId: 3 })],
    ['select placeId null', wrap({ kind: 'select', placeId: null })],
    ['null', null],
    ['문자열', 'x'],
  ])('거부: %s', (_name, data) => {
    expect(parseFromMap(data)).toBeNull();
  });
});
