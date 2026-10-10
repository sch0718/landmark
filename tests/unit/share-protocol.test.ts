import { describe, expect, it } from 'vitest';
import {
  envelope,
  parseFromMap,
  parseToMap,
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
});

describe('envelope', () => {
  it('source와 v를 붙인다', () => {
    expect(envelope({ kind: 'tiles-failed' })).toEqual({
      source: 'tripmap-share',
      v: 1,
      kind: 'tiles-failed',
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
    ['v: 2', wrap({ kind: 'focus', placeId: 'a' }, { v: 2 })],
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
