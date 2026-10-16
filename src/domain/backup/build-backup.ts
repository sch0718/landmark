import { BACKUP_FORMAT, BACKUP_VERSION, type BackupEnvelope } from 'src/schema/backup';
import type { Prefs } from 'src/schema/prefs';

export const BACKUP_MIME = 'application/json';

/**
 * 백업 파일 텍스트를 만든다. `rawLibrary`는 저장소 원문을 `JSON.parse`한 값 그대로여야 한다
 * (디코드한 `Library`로 만들면 이 버전이 모르는 필드를 잃는다). 공백 없는 JSON 한 줄.
 */
export function buildBackupText(input: {
  rawLibrary: unknown;
  prefs: Prefs | null;
  now: Date;
}): string {
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    v: BACKUP_VERSION,
    exportedAt: input.now.toISOString(),
    library: input.rawLibrary,
    ...(input.prefs === null ? {} : { prefs: input.prefs }),
  };
  return JSON.stringify(envelope);
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `landmark-backup-YYYY-MM-DD-HHmm.json`(이 기기 시간). 파일 이름에 쓸 수 없는 `:`은 넣지 않는다. */
export function backupFileName(now: Date): string {
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  return `landmark-backup-${date}-${pad2(now.getHours())}${pad2(now.getMinutes())}.json`;
}
