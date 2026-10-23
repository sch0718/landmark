import type { Library } from 'src/schema/library';

export type LibraryCounts = { places: number; labels: number; trips: number; meetings: number };

type Entry = { createdAt: string; deletedAt: string | null };

const entries = (lib: Library): Entry[] => [
  ...Object.values(lib.places),
  ...Object.values(lib.labels),
  ...Object.values(lib.trips),
  ...Object.values(lib.meetings ?? {}),
];

const liveCount = (items: Record<string, Entry>): number =>
  Object.values(items).filter((item) => item.deletedAt === null).length;

/** 살아 있는(`deletedAt === null`) 장소·라벨·여행·약속의 수. */
export function libraryCounts(lib: Library): LibraryCounts {
  return {
    places: liveCount(lib.places),
    labels: liveCount(lib.labels),
    trips: liveCount(lib.trips),
    meetings: liveCount(lib.meetings ?? {}),
  };
}

export function countsText(counts: LibraryCounts): string {
  return `장소 ${counts.places}곳 · 라벨 ${counts.labels}개 · 여행 ${counts.trips}개 · 약속 ${counts.meetings}개`;
}

/** 묘비를 포함해 항목이 하나라도 있는가. */
export function hasAnyEntry(lib: Library): boolean {
  return entries(lib).length > 0;
}

/** 살아 있는 장소·라벨·여행·약속이 하나라도 있는가. */
export function hasLiveContent(lib: Library): boolean {
  const { places, labels, trips, meetings } = libraryCounts(lib);
  return places + labels + trips + meetings > 0;
}

/** `{ value, updatedAt: string }` 모양의 객체를 재귀로 돌며 `updatedAt`을 모은다. */
function collectUpdatedAt(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectUpdatedAt(item, out);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const record = node as Record<string, unknown>;
  if ('value' in record && typeof record.updatedAt === 'string') out.push(record.updatedAt);
  for (const child of Object.values(record)) collectUpdatedAt(child, out);
}

/** UTC ISO 문자열은 사전순이 시간순이다. */
const maxOf = (values: string[]): string | null =>
  values.length === 0 ? null : values.reduce((a, b) => (a >= b ? a : b));

/**
 * 가장 늦은 변경 시각(스펙 §3.4): 장소·라벨·여행·약속의 `createdAt`·`deletedAt`과 모든 필드의 `updatedAt`,
 * 네이버 폴더 연결의 `createdAt`·`checkedAt`·`deletedAt`.
 * 필드 이름 목록을 두지 않으므로 뒤 묶음이 더하는 필드도 센다.
 */
export function latestChangeAt(lib: Library): string | null {
  const times: string[] = [];
  for (const entry of entries(lib)) {
    times.push(entry.createdAt);
    if (entry.deletedAt !== null) times.push(entry.deletedAt);
  }
  // 네이버 폴더 연결: `확인했어요`가 올리는 `checkedAt`과 끊을 때의 `deletedAt`도 변경이다.
  for (const link of Object.values(lib.folders ?? {})) {
    times.push(link.createdAt, link.checkedAt);
    if (link.deletedAt !== null) times.push(link.deletedAt);
  }
  collectUpdatedAt(lib, times);
  return maxOf(times);
}

/** 묘비를 포함한 항목의 가장 이른 `createdAt`. 항목이 없으면 `null`. */
export function earliestCreatedAt(lib: Library): string | null {
  const created = entries(lib).map((entry) => entry.createdAt);
  return created.length === 0 ? null : created.reduce((a, b) => (a <= b ? a : b));
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `YYYY.MM.DD HH:mm`(이 기기 시간). */
export function formatLocalDateTime(iso: string): string {
  const d = new Date(iso);
  const date = `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
  return `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 이 기기 시간의 달력 날짜 차이(같은 날이면 0, 미래면 0). 알림 띠와 설정 칸이 같은 규칙으로 "N일 전"을 보이게
 * 여기 하나만 둔다. 서머타임으로 하루가 23·25시간이어도 반올림으로 맞춘다.
 */
export function calendarDaysAgo(iso: string, now: Date): number {
  const then = new Date(iso);
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const b = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  return Math.max(0, Math.round((a - b) / 86_400_000));
}
