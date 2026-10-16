import { describe, expect, it, vi } from 'vitest';
import { buildBackupText } from 'src/domain/backup/build-backup';
import {
  BACKUP_FILE_MAX_BYTES,
  BACKUP_READ_MESSAGES,
  readBackupFile,
  readBackupText,
} from 'src/domain/backup/read-backup';
import { LIBRARY_LIMITS, LibrarySchema } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { DEFAULT_PREFS } from 'src/schema/prefs';
import { f, label, lid, makeLibrary, place, trip } from './fixtures';

const NOW = new Date('2026-10-16T05:30:00.000Z');

const raw = () =>
  makeLibrary({
    places: [place(1, { labelIds: f([lid(1)]) }), place(2)],
    labels: [label(1)],
    trips: [trip(1, 2)],
  });

const envelope = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 'tripmap-backup',
    v: 1,
    exportedAt: '2026-10-16T05:30:00.000Z',
    library: raw(),
    ...over,
  });

const errorOf = (text: string) => {
  const r = readBackupText(text);
  return r.ok ? 'ok' : r.error;
};

describe('readBackupText 왕복', () => {
  it('만든 백업을 그대로 읽는다', () => {
    const lib = raw();
    const decoded = safeParse(LibrarySchema, lib);
    if (!decoded.success) throw new Error('fixture invalid');
    const r = readBackupText(buildBackupText({ rawLibrary: lib, prefs: DEFAULT_PREFS, now: NOW }));
    expect(r).toEqual({
      ok: true,
      backup: {
        kind: 'backup',
        exportedAt: '2026-10-16T05:30:00.000Z',
        library: decoded.data,
        prefs: DEFAULT_PREFS,
        droppedUnknown: false,
      },
    });
  });

  it('prefs 없이 만든 백업은 prefs가 null', () => {
    const r = readBackupText(buildBackupText({ rawLibrary: raw(), prefs: null, now: NOW }));
    expect(r.ok && r.backup.prefs).toBeNull();
  });
});

describe('옛 백업(손상 화면 원문)', () => {
  it('저장소 원문은 legacy로 읽는다', () => {
    const r = readBackupText(JSON.stringify(raw()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.kind).toBe('legacy');
    expect(r.backup.exportedAt).toBeNull();
    expect(r.backup.prefs).toBeNull();
    expect(r.backup.droppedUnknown).toBe(false);
    expect(Object.keys(r.backup.library.places)).toHaveLength(2);
  });

  it('schemaVersion 3은 newer', () => {
    expect(errorOf(JSON.stringify({ ...raw(), schemaVersion: 3 }))).toBe('newer');
  });

  it('schemaVersion이 숫자가 아니면 invalid', () => {
    expect(errorOf(JSON.stringify({ ...raw(), schemaVersion: '2' }))).toBe('invalid');
  });
});

describe('버전·형식 오류', () => {
  it('v 2는 newer, 문자열 "1"은 invalid, v 0은 invalid', () => {
    expect(errorOf(envelope({ v: 2 }))).toBe('newer');
    expect(errorOf(envelope({ v: '1' }))).toBe('invalid');
    expect(errorOf(envelope({ v: 0 }))).toBe('invalid');
  });

  it('앞 공백 뒤 <로 시작하면 share-file', () => {
    expect(errorOf('  <!doctype html><html></html>')).toBe('share-file');
    expect(errorOf('\n\t<html>')).toBe('share-file');
  });

  it('백업이 아닌 것들', () => {
    for (const text of ['', 'x', '[]', '{}', 'null', '3', '{"format":"tripmap-share"}']) {
      expect(errorOf(text), text).toBe('not-backup');
    }
  });

  it('봉투는 맞는데 보관함이 깨졌으면 invalid', () => {
    const lib = raw();
    const broken = { ...lib, places: { wrongkey000: lib.places[place(1).id] } };
    expect(errorOf(envelope({ library: broken }))).toBe('invalid');
  });

  it('exportedAt이 시각이 아니면 invalid', () => {
    expect(errorOf(envelope({ exportedAt: 'yesterday' }))).toBe('invalid');
  });

  it('library가 없으면 invalid', () => {
    const withoutLibrary: Record<string, unknown> = JSON.parse(envelope());
    delete withoutLibrary.library;
    expect(errorOf(JSON.stringify(withoutLibrary))).toBe('invalid');
  });
});

describe('모든 장소 출처 종류', () => {
  const allSources = () =>
    makeLibrary({
      places: [
        place(1, { source: { kind: 'naver', sid: '1001' } }),
        place(2, { source: { kind: 'kakao', kakaoId: '2002' } }),
        place(3, { source: { kind: 'google', googleId: '0x1a2b:0x3c4d' } }),
        place(4, { source: { kind: 'pin' } }),
        place(5, {
          source: { kind: 'pin', legacy: { publicId: 'legacypin01', placeKey: 'n:5' } },
        }),
      ],
      trips: [trip(1, 1)],
    });

  const decoded = () => {
    const r = safeParse(LibrarySchema, allSources());
    if (!r.success) throw new Error('fixture invalid');
    return r.data;
  };

  it('백업 왕복에서 모르는 필드로 오인하지 않는다', () => {
    const r = readBackupText(
      buildBackupText({ rawLibrary: allSources(), prefs: DEFAULT_PREFS, now: NOW }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.droppedUnknown).toBe(false);
    expect(r.backup.library).toEqual(decoded());
  });

  it('옛 백업(저장소 원문)에서도 오인하지 않는다', () => {
    const r = readBackupText(JSON.stringify(allSources()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.kind).toBe('legacy');
    expect(r.backup.droppedUnknown).toBe(false);
    expect(r.backup.library).toEqual(decoded());
  });

  it('출처 안의 진짜 모르는 키는 잡아낸다', () => {
    const lib = allSources();
    const p5 = lib.places[place(5).id]!;
    const withFuture = {
      ...lib,
      places: {
        ...lib.places,
        [p5.id]: {
          ...p5,
          source: { kind: 'pin', legacy: { publicId: 'legacypin01', placeKey: 'n:5', extra: 1 } },
        },
      },
    };
    const r = readBackupText(JSON.stringify(withFuture));
    expect(r.ok && r.backup.droppedUnknown).toBe(true);
  });
});

describe('모르는 필드', () => {
  it('장소의 모르는 필드는 버리고 droppedUnknown', () => {
    const lib = raw();
    const p1 = lib.places[place(1).id]!;
    const withFuture = {
      ...lib,
      places: { ...lib.places, [p1.id]: { ...p1, futureField: f(1) } },
    };
    const r = readBackupText(envelope({ library: withFuture }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.droppedUnknown).toBe(true);
    expect(r.backup.library.places[p1.id]).not.toHaveProperty('futureField');
  });

  it('보관함 최상위의 모르는 컬렉션도 droppedUnknown', () => {
    const r = readBackupText(envelope({ library: { ...raw(), futureCollection: {} } }));
    expect(r.ok && r.backup.droppedUnknown).toBe(true);
    expect(r.ok && r.backup.library).not.toHaveProperty('futureCollection');
  });

  it('봉투 최상위의 모르는 필드는 조용히 무시한다', () => {
    const r = readBackupText(envelope({ extra: {} }));
    expect(r.ok && r.backup.droppedUnknown).toBe(false);
  });
});

describe('prefs', () => {
  it('못 읽는 prefs는 조용히 버린다', () => {
    const r = readBackupText(envelope({ prefs: { theme: 'neon' } }));
    expect(r.ok).toBe(true);
    expect(r.ok && r.backup.prefs).toBeNull();
  });
});

describe('too-large', () => {
  it('직렬화가 4,000,000자를 넘으면 too-large', () => {
    const memo = 'a'.repeat(LIBRARY_LIMITS.memoChars);
    const places = Array.from({ length: 410 }, (_, i) => place(i + 1, { memo: f(memo) }));
    const text = envelope({ library: makeLibrary({ places }) });
    expect(text.length).toBeGreaterThan(4_000_000);
    expect(errorOf(text)).toBe('too-large');
  });
});

describe('readBackupFile', () => {
  it('16,777,216바이트 초과는 내용을 읽지 않고 too-big', async () => {
    const blob = new Blob([new Uint8Array(BACKUP_FILE_MAX_BYTES + 1)]);
    const spy = vi.spyOn(blob, 'text');
    expect(await readBackupFile(blob)).toEqual({ ok: false, error: 'too-big' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('한도 안이면 내용을 읽는다', async () => {
    const text = buildBackupText({ rawLibrary: raw(), prefs: null, now: NOW });
    const r = await readBackupFile(new Blob([text]));
    expect(r.ok && r.backup.kind).toBe('backup');
  });

  it('파일을 읽다 실패하면 invalid', async () => {
    const blob = new Blob(['x']);
    vi.spyOn(blob, 'text').mockRejectedValue(new Error('boom'));
    expect(await readBackupFile(blob)).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('BACKUP_READ_MESSAGES', () => {
  it('고정 문구와 글자까지 같다', () => {
    expect(BACKUP_READ_MESSAGES).toEqual({
      'too-big': '파일이 너무 커요',
      'share-file': "공유 파일이에요. 설정 › 가져오기의 '공유 파일 가져오기'로 넣어 주세요",
      'not-backup': 'Landmark 백업 파일이 아니에요',
      newer: '더 새 버전의 Landmark에서 만든 백업이에요. 앱을 새로 고친 뒤 다시 시도해 주세요',
      invalid: '백업 파일을 읽지 못했어요. 파일이 손상됐을 수 있어요',
      'too-large': '보관함이 너무 커서 되살릴 수 없어요',
    });
  });
});
