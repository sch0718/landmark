import { Schema } from 'effect';
import { IsoDateTime } from 'src/schema/common';

export const BACKUP_FORMAT = 'tripmap-backup';
export const BACKUP_VERSION = 1;

/**
 * 백업 파일의 봉투. `library`는 저장소 원문 그대로라 여기서는 안을 보지 않는다
 * (`LibrarySchema` 검사와 모르는 필드 판정은 `readBackupText`가 한다).
 * 모르는 최상위 필드는 Effect 기본값(`onExcessProperty: 'ignore'`)으로 무시한다.
 */
export const BackupEnvelopeSchema = Schema.Struct({
  format: Schema.Literal(BACKUP_FORMAT),
  v: Schema.Literal(BACKUP_VERSION),
  exportedAt: IsoDateTime,
  library: Schema.Unknown,
  prefs: Schema.optionalKey(Schema.Unknown),
});

export type BackupEnvelope = {
  format: typeof BACKUP_FORMAT;
  v: typeof BACKUP_VERSION;
  exportedAt: string;
  library: unknown;
  prefs?: unknown;
};

/**
 * 마지막 백업 기록(`tripmap:backup:v1`). 시각은 화면에 `YYYY.MM.DD HH:mm`으로 찍히므로
 * 읽을 때 `IsoDateTime`으로 걸러 NaN 문구가 나오지 않게 한다.
 */
export const BackupMetaSchema = Schema.Struct({
  lastBackupAt: Schema.NullOr(IsoDateTime),
  snoozedAt: Schema.NullOr(IsoDateTime),
});

export type BackupMeta = { lastBackupAt: string | null; snoozedAt: string | null };

export const EMPTY_BACKUP_META: BackupMeta = { lastBackupAt: null, snoozedAt: null };
