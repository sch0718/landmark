import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  emptyLibrary,
  LABEL_COLORS,
  LABEL_ICONS,
  LIBRARY_LIMITS,
  LibrarySchema,
  normalizeLabelName,
  type Label,
  type Library,
  type Place,
} from 'src/schema/library';
import { safeParse } from 'src/schema/parse';

const T = '2026-10-08T01:00:00.000Z';
const f = <V>(value: V) => ({ value, updatedAt: T });

let seq = 0;
const placeId = () => `p${String(seq++).padStart(9, '0')}`;
const labelId = () => `l${String(seq++).padStart(7, '0')}`;

function place(over: Partial<Place> = {}): Place {
  return {
    id: placeId(),
    source: { kind: 'naver', sid: String(1000 + seq) },
    name: f('안목해변 카페'),
    address: '강원 강릉시 창해로 14번길 20',
    lng: 128.95,
    lat: 37.77,
    category: f<string | null>('카페'),
    labelIds: f<string[]>([]),
    memo: f(''),
    saved: f(true),
    createdAt: T,
    deletedAt: null,
    ...over,
  };
}

function label(name: string, over: Partial<Label> = {}): Label {
  return {
    id: labelId(),
    name: f(name),
    color: f<Label['color']['value']>('red'),
    icon: f<Label['icon']['value']>('star'),
    order: f(0),
    createdAt: T,
    deletedAt: null,
    ...over,
  };
}

function lib(places: Place[] = [], labels: Label[] = [], extra: object = {}): unknown {
  return {
    ...emptyLibrary(),
    places: Object.fromEntries(places.map((p) => [p.id, p])),
    labels: Object.fromEntries(labels.map((l) => [l.id, l])),
    ...extra,
  };
}

function messages(value: unknown): string[] {
  const r = safeParse(LibrarySchema, value);
  return r.success ? [] : r.issues.map((i) => i.message);
}

describe('LibrarySchema', () => {
  it('accepts a minimal valid library', () => {
    expect(safeParse(LibrarySchema, emptyLibrary()).success).toBe(true);
    const l = label('맛집');
    const p = place({ labelIds: f([l.id]) });
    expect(safeParse(LibrarySchema, lib([p], [l])).success).toBe(true);
  });

  it('emptyLibrary has the v2 shape', () => {
    const e: Library = emptyLibrary();
    expect(e).toEqual({ schemaVersion: 2, places: {}, labels: {}, trips: {} });
  });

  it('rejects duplicate live naver sid', () => {
    const a = place({ source: { kind: 'naver', sid: '12345' } });
    const b = place({ source: { kind: 'naver', sid: '12345' } });
    expect(messages(lib([a, b]))).toContain('네이버 장소가 중복됩니다: 12345');
    const dead = { ...b, deletedAt: T };
    expect(safeParse(LibrarySchema, lib([a, dead])).success).toBe(true);
  });

  it('accepts kakao and google sources and round-trips them through encode', () => {
    const kakao = place({ source: { kind: 'kakao', kakaoId: '8047571' } });
    const google = place({
      source: { kind: 'google', googleId: '0x35629cbc2ee1e3cb:0x1a2b3c4d5e6f7a8b' },
    });
    const input = lib([kakao, google]);
    const decoded = safeParse(LibrarySchema, input);
    expect(decoded.success).toBe(true);
    if (decoded.success) {
      const encoded = Schema.encodeSync(LibrarySchema)(decoded.data);
      expect(encoded).toEqual(input);
    }
  });

  it('rejects malformed kakaoId and googleId', () => {
    const bad = (p: Place) =>
      safeParse(LibrarySchema, { ...(lib() as object), places: { [p.id]: p } });
    expect(bad(place({ source: { kind: 'kakao', kakaoId: 'abc' } })).success).toBe(false);
    expect(bad(place({ source: { kind: 'kakao', kakaoId: '' } })).success).toBe(false);
    expect(bad(place({ source: { kind: 'google', googleId: '123' } })).success).toBe(false);
    expect(bad(place({ source: { kind: 'google', googleId: '0xABC:0xDEF' } })).success).toBe(false);
  });

  it('rejects duplicate live kakaoId', () => {
    const a = place({ source: { kind: 'kakao', kakaoId: '8047571' } });
    const b = place({ source: { kind: 'kakao', kakaoId: '8047571' } });
    expect(messages(lib([a, b]))).toContain('카카오 장소가 중복됩니다: 8047571');
    const dead = { ...b, deletedAt: T };
    expect(safeParse(LibrarySchema, lib([a, dead])).success).toBe(true);
  });

  it('rejects duplicate live googleId', () => {
    const googleId = '0x35629cbc2ee1e3cb:0x1a2b3c4d5e6f7a8b';
    const a = place({ source: { kind: 'google', googleId } });
    const b = place({ source: { kind: 'google', googleId } });
    expect(messages(lib([a, b]))).toContain(`구글 장소가 중복됩니다: ${googleId}`);
    const dead = { ...b, deletedAt: T };
    expect(safeParse(LibrarySchema, lib([a, dead])).success).toBe(true);
  });

  it('reports the offending place id as the issue path', () => {
    const a = place({ source: { kind: 'naver', sid: '777' } });
    const b = place({ source: { kind: 'naver', sid: '777' } });
    const r = safeParse(LibrarySchema, lib([a, b]));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.issues.map((i) => i.path)).toContain(`places.${b.id}`);
    }
  });

  it('rejects duplicate live legacy pin', () => {
    const legacy = { publicId: 'abcdefghij', placeKey: 'c:x1' };
    const a = place({ source: { kind: 'pin', legacy } });
    const b = place({ source: { kind: 'pin', legacy } });
    expect(messages(lib([a, b]))).toContain('옛 사용자 지정 장소가 중복됩니다: abcdefghij/c:x1');
    const c = place({ source: { kind: 'pin' } });
    const d = place({ source: { kind: 'pin' } });
    expect(safeParse(LibrarySchema, lib([c, d])).success).toBe(true);
  });

  it('rejects duplicate live label name ignoring case and spaces', () => {
    const dup1 = lib([], [label('맛집'), label(' 맛집 ')]);
    expect(messages(dup1)).toContain('라벨 이름이 중복됩니다: 맛집');
    const dup2 = lib([], [label('Cafe'), label('cafe')]);
    expect(messages(dup2)).toContain('라벨 이름이 중복됩니다: cafe');
    const dead = lib([], [label('맛집'), label('맛집', { deletedAt: T })]);
    expect(safeParse(LibrarySchema, dead).success).toBe(true);
  });

  it('rejects labelIds pointing to missing or deleted label', () => {
    const gone = label('삭제됨', { deletedAt: T });
    const missing = 'zzzzzzzz';
    const p = place({ labelIds: f([missing, gone.id]) });
    const m = messages(lib([p], [gone]));
    expect(m).toContain(`없는 라벨입니다: ${missing}`);
    expect(m).toContain(`없는 라벨입니다: ${gone.id}`);
  });

  it('enforces memo 10000 and label name 1..30', () => {
    const memo = (n: number) => lib([place({ memo: f('가'.repeat(n)) })]);
    expect(LIBRARY_LIMITS.memoChars).toBe(10_000);
    expect(safeParse(LibrarySchema, memo(10_000)).success).toBe(true);
    expect(safeParse(LibrarySchema, memo(10_001)).success).toBe(false);
    const name = (n: number) => lib([], [label('a'.repeat(n))]);
    expect(safeParse(LibrarySchema, name(0)).success).toBe(false);
    expect(safeParse(LibrarySchema, name(31)).success).toBe(false);
    expect(safeParse(LibrarySchema, name(30)).success).toBe(true);
    expect(safeParse(LibrarySchema, name(1)).success).toBe(true);
  });

  it('rejects record keys that differ from the entry id instead of dropping them', () => {
    const p = place();
    const l = label('맛집');
    const badPlace = { ...(lib() as object), places: { WRONGKEY: p } };
    expect(messages(badPlace)).toContain('키와 id가 다릅니다: WRONGKEY');
    const badLabel = { ...(lib() as object), labels: { WRONGKEY: l } };
    expect(messages(badLabel)).toContain('키와 id가 다릅니다: WRONGKEY');
  });

  it('rejects non-empty trips', () => {
    expect(safeParse(LibrarySchema, lib([], [], { trips: { x: {} } })).success).toBe(false);
  });

  it('rejects malformed ids, enums and coordinates', () => {
    const bad = (p: Place) =>
      safeParse(LibrarySchema, { ...(lib() as object), places: { [p.id]: p } });
    expect(bad(place({ id: 'ABCDEFGHIJ' })).success).toBe(false);
    expect(bad(place({ id: 'abc' })).success).toBe(false);
    expect(bad(place({ source: { kind: 'naver', sid: 'abc' } })).success).toBe(false);
    expect(bad(place({ lng: 100 })).success).toBe(false);
    const l = label('x');
    const withColor = {
      ...(lib() as object),
      labels: { [l.id]: { ...l, color: f('magenta') } },
    };
    expect(safeParse(LibrarySchema, withColor).success).toBe(false);
    const withIcon = { ...(lib() as object), labels: { [l.id]: { ...l, icon: f('nope') } } };
    expect(safeParse(LibrarySchema, withIcon).success).toBe(false);
  });
});

describe('constants', () => {
  it('LABEL_COLORS and LABEL_ICONS keep the specified order', () => {
    expect(LABEL_COLORS).toEqual([
      'red',
      'orange',
      'yellow',
      'green',
      'teal',
      'blue',
      'purple',
      'pink',
    ]);
    expect(LABEL_ICONS).toHaveLength(32);
    expect(LABEL_ICONS[0]).toBe('utensils');
    expect(LABEL_ICONS[31]).toBe('flag');
    expect(LIBRARY_LIMITS).toEqual({
      memoChars: 10_000,
      labelNameChars: 30,
      libraryChars: 4_000_000,
    });
  });
});

describe('normalizeLabelName', () => {
  it('trims, collapses whitespace, lowercases', () => {
    expect(normalizeLabelName('  Cafe   Latte ')).toBe('cafe latte');
  });
});
