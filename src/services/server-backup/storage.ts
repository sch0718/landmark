export const SERVER_BACKUP_KEY = 'tripmap:server-backup:v1';
export const SERVER_BACKUP_EVENT = 'tripmap:server-backup';
export type AutoOutcome =
  | 'uploaded'
  | 'skipped-empty'
  | 'skipped-shrunk'
  | 'too-large'
  | 'unsupported'
  | 'off'
  | 'limit'
  | 'failed';
export type ServerBackupLocal = {
  v: 1;
  auto: boolean;
  userId: string | null;
  nextCheckAt: number | null;
  last: { at: number; outcome: AutoOutcome } | null;
};
export const EMPTY_SERVER_BACKUP_LOCAL: ServerBackupLocal = {
  v: 1,
  auto: false,
  userId: null,
  nextCheckAt: null,
  last: null,
};
const outcomes: AutoOutcome[] = [
  'uploaded',
  'skipped-empty',
  'skipped-shrunk',
  'too-large',
  'unsupported',
  'off',
  'limit',
  'failed',
];
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
export function readServerBackupLocal(storage: Storage | undefined): ServerBackupLocal {
  try {
    const v = JSON.parse(storage?.getItem(SERVER_BACKUP_KEY) ?? 'null') as ServerBackupLocal | null;
    if (
      v?.v === 1 &&
      typeof v.auto === 'boolean' &&
      (v.userId === null || typeof v.userId === 'string') &&
      (v.nextCheckAt === null || integer(v.nextCheckAt)) &&
      (v.last === null || (integer(v.last.at) && outcomes.includes(v.last.outcome)))
    )
      return v;
  } catch {
    /* 읽지 못한 기록은 버린다 */
  }
  return { ...EMPTY_SERVER_BACKUP_LOCAL };
}
export function writeServerBackupLocal(
  storage: Storage | undefined,
  value: ServerBackupLocal,
): void {
  try {
    storage?.setItem(SERVER_BACKUP_KEY, JSON.stringify(value));
  } catch {
    console.warn('서버 백업 기록을 저장하지 못했어요');
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SERVER_BACKUP_EVENT));
}
