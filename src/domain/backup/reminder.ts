import {
  calendarDaysAgo,
  earliestCreatedAt,
  latestChangeAt,
  libraryCounts,
} from 'src/domain/backup/summary';
import type { BackupMeta } from 'src/schema/backup';
import type { Library } from 'src/schema/library';

export const REMIND_AFTER_DAYS = 7;
export const SNOOZE_DAYS = 7;

const DAY_MS = 86_400_000;

export type ReminderState = null | { kind: 'never' } | { kind: 'stale'; days: number };

/**
 * 백업 알림 띠를 띄울지(스펙 §2.5). 모든 조건이 참일 때만 상태를 돌려준다.
 * 시각은 모두 UTC ISO(사전순 = 시간순)이고 `meta`는 읽을 때 스키마로 검증된다.
 */
export function reminderState(input: {
  library: Library;
  meta: BackupMeta;
  persistence: 'local' | 'memory';
  now: number;
}): ReminderState {
  const { library, meta, persistence, now } = input;
  if (persistence !== 'local') return null;
  // 살아 있는 장소나 여행이 하나 이상(라벨만 있으면 잃어도 크지 않다).
  const { places, trips } = libraryCounts(library);
  if (places + trips === 0) return null;
  const changedAt = latestChangeAt(library);
  if (changedAt === null) return null;
  if (meta.snoozedAt !== null && now - Date.parse(meta.snoozedAt) < SNOOZE_DAYS * DAY_MS) {
    return null;
  }
  const limit = REMIND_AFTER_DAYS * DAY_MS;
  if (meta.lastBackupAt === null) {
    const first = earliestCreatedAt(library);
    return first !== null && now - Date.parse(first) >= limit ? { kind: 'never' } : null;
  }
  if (changedAt <= meta.lastBackupAt) return null;
  const elapsed = now - Date.parse(meta.lastBackupAt);
  // 임계는 경과 시간, 보이는 일수는 달력 날짜 차이(설정 칸과 같은 규칙).
  return elapsed >= limit
    ? { kind: 'stale', days: calendarDaysAgo(meta.lastBackupAt, new Date(now)) }
    : null;
}

export function reminderText(state: Exclude<ReminderState, null>): string {
  return state.kind === 'never'
    ? '아직 백업하지 않았어요. 보관함은 이 기기에만 있어요'
    : `마지막 백업이 ${state.days}일 전이에요. 그 뒤로 바뀐 내용이 있어요`;
}
