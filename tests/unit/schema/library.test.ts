import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  emptyLibrary,
  LABEL_COLORS,
  LABEL_ICONS,
  LABEL_NAME_RANGE_MESSAGE,
  labelNameIssue,
  LIBRARY_LIMITS,
  LabelSchema,
  LibrarySchema,
  normalizeLabelName,
  PlaceSchema,
  type FolderLink,
  type Label,
  type Library,
  type Place,
} from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { TripSchema } from 'src/schema/trip';

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
      meetingsMax: 200,
      meetingParticipantsMax: 10,
      meetingCandidatesMax: 8,
      meetingTitleChars: 60,
      meetingNameChars: 20,
      memoChars: 10_000,
      reviewChars: 140,
      labelNameChars: 30,
      libraryChars: 4_000_000,
      tripTitleChars: 60,
      tripMaxDays: 30,
      stopNoteChars: 500,
      stayMaxMin: 1440,
      folderNameChars: 100,
      folderSids: 1000,
    });
  });
});

describe('normalizeLabelName', () => {
  it('trims, collapses whitespace, lowercases', () => {
    expect(normalizeLabelName('  Cafe   Latte ')).toBe('cafe latte');
  });
});

describe('labelNameIssue', () => {
  it('flags empty and whitespace-only names as empty', () => {
    expect(labelNameIssue('')).toBe('empty');
    expect(labelNameIssue('   ')).toBe('empty');
  });

  it('judges the length after trimming', () => {
    const max = LIBRARY_LIMITS.labelNameChars;
    expect(labelNameIssue('가'.repeat(max))).toBeNull();
    expect(labelNameIssue('가'.repeat(max + 1))).toBe('too-long');
    expect(labelNameIssue(` ${'가'.repeat(max)} `)).toBeNull();
  });
});

describe('LABEL_NAME_RANGE_MESSAGE', () => {
  it('states the 1 to max range', () => {
    expect(LABEL_NAME_RANGE_MESSAGE).toBe('1–30자로 입력하세요');
  });
});

describe('LibrarySchema folders', () => {
  function folder(labelId: string, over: Partial<FolderLink> = {}): FolderLink {
    return {
      shareId: 'fb65e7f93f8a4144a4ded594d604a7aa',
      name: f('속초, 고성, 양양 맛집'),
      labelId: f(labelId),
      seenSids: f<string[]>(['1001', '1002']),
      checkedAt: T,
      createdAt: T,
      deletedAt: null,
      ...over,
    };
  }
  /** 키를 `shareId`로 맞춘 `folders` 컬렉션. */
  const folders = (...links: FolderLink[]) => ({
    folders: Object.fromEntries(links.map((k) => [k.shareId, k])),
  });

  it('accepts a library without folders, with empty folders, and with a live link', () => {
    const l = label('속초');
    expect(safeParse(LibrarySchema, lib([], [l])).success).toBe(true);
    expect(safeParse(LibrarySchema, lib([], [l], { folders: {} })).success).toBe(true);
    expect(safeParse(LibrarySchema, lib([], [l], folders(folder(l.id)))).success).toBe(true);
  });

  it('round-trips a link through encode', () => {
    const l = label('속초');
    const input = lib([], [l], folders(folder(l.id)));
    const decoded = safeParse(LibrarySchema, input);
    expect(decoded.success).toBe(true);
    if (decoded.success) expect(Schema.encodeSync(LibrarySchema)(decoded.data)).toEqual(input);
  });

  it('rejects a key that differs from shareId', () => {
    const l = label('속초');
    const link = folder(l.id);
    const r = safeParse(LibrarySchema, lib([], [l], { folders: { abc123: link } }));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.issues).toContainEqual({
        path: 'folders.abc123',
        message: '키와 id가 다릅니다: abc123',
      });
    }
  });

  it('rejects a live link pointing to a missing or deleted label', () => {
    const l = label('속초');
    const missing = folder('zzzzzzzz');
    expect(messages(lib([], [l], folders(missing)))).toContain('없는 라벨입니다: zzzzzzzz');
    const gone = label('지움', { deletedAt: T });
    const bad = safeParse(LibrarySchema, lib([], [l, gone], folders(folder(gone.id))));
    expect(bad.success).toBe(false);
    if (!bad.success)
      expect(bad.issues.map((i) => i.path)).toContain(`folders.${folder(l.id).shareId}`);
  });

  it('accepts a deleted link even when its label is missing or deleted', () => {
    const gone = label('지움', { deletedAt: T });
    const dead = folder(gone.id, { deletedAt: T });
    expect(safeParse(LibrarySchema, lib([], [gone], folders(dead))).success).toBe(true);
    const nowhere = folder('zzzzzzzz', { deletedAt: T });
    expect(safeParse(LibrarySchema, lib([], [], folders(nowhere))).success).toBe(true);
  });

  it('enforces the name length limit', () => {
    const l = label('속초');
    const ok = folder(l.id, { name: f('가'.repeat(LIBRARY_LIMITS.folderNameChars)) });
    expect(safeParse(LibrarySchema, lib([], [l], folders(ok))).success).toBe(true);
    const long = folder(l.id, { name: f('가'.repeat(LIBRARY_LIMITS.folderNameChars + 1)) });
    expect(safeParse(LibrarySchema, lib([], [l], folders(long))).success).toBe(false);
  });

  it('enforces the seenSids count limit and the digit-only pattern', () => {
    const l = label('속초');
    const sids = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));
    const ok = folder(l.id, { seenSids: f(sids(LIBRARY_LIMITS.folderSids)) });
    expect(safeParse(LibrarySchema, lib([], [l], folders(ok))).success).toBe(true);
    const many = folder(l.id, { seenSids: f(sids(LIBRARY_LIMITS.folderSids + 1)) });
    expect(safeParse(LibrarySchema, lib([], [l], folders(many))).success).toBe(false);
    const alpha = folder(l.id, { seenSids: f(['12a']) });
    expect(safeParse(LibrarySchema, lib([], [l], folders(alpha))).success).toBe(false);
  });

  it('rejects a shareId that is not alphanumeric', () => {
    const l = label('속초');
    const bad = folder(l.id, { shareId: 'ab-c' });
    expect(safeParse(LibrarySchema, lib([], [l], folders(bad))).success).toBe(false);
  });

  it('is read by the old shape (no folders) and the key is dropped', () => {
    // 옛 버전의 `LibraryStore`는 `folders`를 모르는 구조체로 `safeParse`한다. 모르는 키는 기본값
    // `onExcessProperty: "ignore"`로 떼어 낸 채 읽고 다시 쓴다(스펙 §5.3).
    const OldLibrarySchema = Schema.Struct({
      schemaVersion: Schema.Literal(2),
      places: Schema.Record(Schema.String, PlaceSchema),
      labels: Schema.Record(Schema.String, LabelSchema),
      trips: Schema.Record(Schema.String, TripSchema),
    });
    const l = label('속초');
    const r = safeParse(OldLibrarySchema, lib([], [l], folders(folder(l.id))));
    expect(r.success).toBe(true);
    if (r.success) expect('folders' in r.data).toBe(false);
  });
});
