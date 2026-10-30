import {
  calendarDaysAgo,
  countsText,
  formatLocalDateTime,
  type LibraryCounts,
} from 'src/domain/backup/summary';
import type { BackupFailure, ServerBackupMeta } from 'src/services/server-backup/api';
import type { BuildFailure } from 'src/services/server-backup/snapshot';
import type { AutoOutcome } from 'src/services/server-backup/storage';
export const SERVER_BACKUP_TITLE = '서버 백업';
export const SIGNED_OUT = '로그인하면 서버에도 보관함 백업을 하나 둘 수 있어요';
export const LOADING = '서버 백업을 확인하는 중…';
export const CREATING = '서버 백업을 만드는 중…';
export const NOTE =
  '서버 백업은 하나만 두고 새로 만들면 덮어써요. 암호화하지 않고 저장해요. 서버 장애에 대비해 백업 파일도 가끔 받아 두세요.';
export const AUTO_LABEL = '자동 백업';
export const AUTO_HELP =
  '이 기기에서 앱을 열 때, 마지막 서버 백업이 하루가 지났고 그 뒤로 바뀐 내용이 있으면 새로 올려요. 서버 백업은 하나만 두고 덮어써요.';
export const AUTO_NEEDS_SYNC = '동기화를 켠 기기에서만 자동 백업을 할 수 있어요';
export const NOT_WRITABLE = '지금은 서버 백업을 새로 만들 수 없어요';
export const RESTORE_TITLE = '서버 백업에서 되살리기';
export const RESTORE_LOADING = '서버 백업을 받는 중…';
export function metaLine(meta: ServerBackupMeta | null, now: Date): string {
  if (!meta) return '서버 백업: 없음';
  const iso = new Date(meta.createdAt).toISOString();
  const days = calendarDaysAgo(iso, now);
  return `서버 백업: ${formatLocalDateTime(iso)} (${days === 0 ? '오늘' : `${days}일 전`}) · ${countsText(meta.counts)} · ${meta.deviceLabel}${meta.reason === 'auto' ? ' · 자동' : ''}`;
}
export function restoreHeader(meta: ServerBackupMeta): string {
  return `서버 백업 · ${formatLocalDateTime(new Date(meta.createdAt).toISOString())} · ${meta.deviceLabel}`;
}
export function failureText(
  reason: BackupFailure | BuildFailure | 'library',
  action: 'read' | 'write' | 'restore' | 'delete',
): string {
  switch (reason) {
    case 'auth':
      return '동기화 로그인이 끊겼어요. 다시 로그인해 주세요';
    case 'not-allowed':
      return '이 계정은 서버 백업을 쓸 수 없어요';
    case 'offline':
    case 'server':
      return action === 'read' ? '서버 백업을 확인하지 못했어요' : '서버에 연결하지 못했어요';
    case 'limit':
      return action === 'restore'
        ? '오늘은 서버 백업을 더 받을 수 없어요. 내일 다시 해 주세요'
        : '오늘은 서버 백업을 더 만들 수 없어요. 내일 다시 해 주세요';
    case 'off':
      return '지금은 서버 백업을 쓸 수 없어요';
    case 'too-large':
      return '보관함이 커서 서버 백업을 만들 수 없어요. 백업 파일 받기를 이용해 주세요';
    case 'unsupported':
      return '이 브라우저에서는 서버 백업을 만들 수 없어요';
    case 'changed':
      return '서버 백업이 그사이 바뀌었어요. 창을 닫고 다시 열어 주세요';
    case 'not-found':
      return '서버 백업이 없어요';
    case 'library':
      return '보관함을 읽지 못해 서버 백업을 만들지 못했어요';
    case 'invalid':
      return '서버 백업을 만들지 못했어요';
  }
}
export function autoOutcomeText(last: { at: number; outcome: AutoOutcome }): string {
  return {
    uploaded: `자동 백업: ${formatLocalDateTime(new Date(last.at).toISOString()).slice(5)} 올림`,
    'skipped-shrunk':
      "자동 백업 건너뜀: 장소·여행이 서버 백업보다 크게 줄었어요. 맞다면 '서버 백업 지금 만들기'를 눌러 주세요",
    'skipped-empty': '자동 백업 건너뜀: 보관함이 비어 있어요',
    'too-large': '자동 백업 못 함: 보관함이 커서 서버 백업을 만들 수 없어요',
    unsupported: '자동 백업 못 함: 이 브라우저에서는 서버 백업을 만들 수 없어요',
    off: '자동 백업 멈춤: 지금은 서버 백업을 쓸 수 없어요',
    limit: '자동 백업 멈춤: 오늘 서버 백업 한도를 넘었어요',
    failed: '자동 백업 실패: 다음에 앱을 열 때 다시 해요',
  }[last.outcome];
}
export function overwriteConfirmText(
  meta: ServerBackupMeta | null,
  current: LibraryCounts,
  syncOn: boolean,
  now: Date,
): string | null {
  if (!meta) return null;
  const before = meta.counts.places + meta.counts.trips;
  const shrunk = before >= 20 && current.places + current.trips < before / 2;
  if (syncOn && !shrunk) return null;
  return `서버 백업을 이 기기 보관함으로 바꿔요. 지금 ${metaLine(meta, now)}${shrunk ? ' 서버 백업보다 장소·여행이 많이 적어요.' : ''}`;
}
