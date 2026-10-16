import { BACKUP_FORMAT, BACKUP_VERSION, BackupEnvelopeSchema } from 'src/schema/backup';
import { LIBRARY_LIMITS, LibrarySchema, type Library } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { PrefsSchema, type Prefs } from 'src/schema/prefs';

/** 백업 파일 크기 한도(바이트). 넘으면 내용을 읽지 않는다. */
export const BACKUP_FILE_MAX_BYTES = 16_777_216;

/** 저장소 문서 형식의 버전(`LibrarySchema.schemaVersion`). 옛 백업(손상 화면 원문)의 새 버전 판정에 쓴다. */
const LIBRARY_SCHEMA_VERSION = 2;

export type BackupReadError =
  'too-big' | 'share-file' | 'not-backup' | 'newer' | 'invalid' | 'too-large';

export const BACKUP_READ_MESSAGES: Record<BackupReadError, string> = {
  'too-big': '파일이 너무 커요',
  'share-file': "공유 파일이에요. 설정 › 가져오기의 '공유 파일 가져오기'로 넣어 주세요",
  'not-backup': 'Landmark 백업 파일이 아니에요',
  newer: '더 새 버전의 Landmark에서 만든 백업이에요. 앱을 새로 고친 뒤 다시 시도해 주세요',
  invalid: '백업 파일을 읽지 못했어요. 파일이 손상됐을 수 있어요',
  'too-large': '보관함이 너무 커서 되살릴 수 없어요',
};

export type ReadBackup = {
  /** `backup`은 이 앱이 만든 백업, `legacy`는 손상 화면이 받은 저장소 원문. */
  kind: 'backup' | 'legacy';
  exportedAt: string | null;
  library: Library;
  prefs: Prefs | null;
  /** 이 버전이 모르는 필드가 있어 되살리면 그 정보가 빠진다. */
  droppedUnknown: boolean;
};

export type BackupReadResult =
  { ok: true; backup: ReadBackup } | { ok: false; error: BackupReadError };

const fail = (error: BackupReadError): BackupReadResult => ({ ok: false, error });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 백업 텍스트를 읽는다. 순서와 규칙은 스펙 §3.2. */
export function readBackupText(text: string): BackupReadResult {
  if (text.trimStart().startsWith('<')) return fail('share-file');

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail('not-backup');
  }
  if (!isRecord(json)) return fail('not-backup');

  let kind: ReadBackup['kind'];
  let exportedAt: string | null = null;
  let rawLibrary: unknown;
  let rawPrefs: unknown;

  if (json.format === BACKUP_FORMAT) {
    const { v } = json;
    if (typeof v === 'number' && Number.isInteger(v) && v > BACKUP_VERSION) return fail('newer');
    if (v !== BACKUP_VERSION) return fail('invalid');
    const envelope = safeParse(BackupEnvelopeSchema, json);
    if (!envelope.success) return fail('invalid');
    kind = 'backup';
    exportedAt = envelope.data.exportedAt;
    rawLibrary = envelope.data.library;
    rawPrefs = envelope.data.prefs;
  } else if (!('format' in json) && 'schemaVersion' in json) {
    const { schemaVersion } = json;
    if (typeof schemaVersion === 'number' && schemaVersion > LIBRARY_SCHEMA_VERSION) {
      return fail('newer');
    }
    kind = 'legacy';
    rawLibrary = json;
  } else {
    return fail('not-backup');
  }

  const library = safeParse(LibrarySchema, rawLibrary);
  if (!library.success) return fail('invalid');
  if (JSON.stringify(library.data).length > LIBRARY_LIMITS.libraryChars) return fail('too-large');

  // 위에서 통과했으므로 여기서 실패하는 이유는 이 버전이 모르는 필드뿐이다.
  const droppedUnknown = !safeParse(LibrarySchema, rawLibrary, { onExcessProperty: 'error' })
    .success;

  // 설정은 잃어도 되는 데이터라 못 읽으면 조용히 버린다(`PrefsStore`와 같은 원칙).
  const prefs = safeParse(PrefsSchema, rawPrefs);

  return {
    ok: true,
    backup: {
      kind,
      exportedAt,
      library: library.data,
      prefs: prefs.success ? prefs.data : null,
      droppedUnknown,
    },
  };
}

/** 크기를 먼저 보고, 한도 안일 때만 내용을 읽는다. */
export async function readBackupFile(file: Blob): Promise<BackupReadResult> {
  if (file.size > BACKUP_FILE_MAX_BYTES) return fail('too-big');
  let text: string;
  try {
    text = await file.text();
  } catch {
    return fail('invalid');
  }
  return readBackupText(text);
}
