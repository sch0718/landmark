import type { AgentChangeView, AgentTokenView, InboxItemView } from 'src/services/agent-inbox/api';

function dateParts(value: string): [number, number, number] {
  return value.split('-').map(Number) as [number, number, number];
}

function monthDay(date: Date): string {
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

/** 여행 날짜는 UTC로 바꾸지 않고 문서에 적힌 달력 날짜 그대로 써요. */
export const inboxLine: (item: InboxItemView, now: Date) => string = (item) => {
  const [sy, sm, sd] = dateParts(item.startDate);
  const [ey, em, ed] = dateParts(item.endDate);
  let period = `${sm}월 ${sd}일`;
  if (sy !== ey) period = `${sy}년 ${period}~${ey}년 ${em}월 ${ed}일`;
  else if (sm !== em) period += `~${em}월 ${ed}일`;
  else if (sd !== ed) period += `~${ed}일`;
  return `${item.title} · ${period} · 장소 ${item.places}곳`;
};

/** 일광 절약 시간제와 상관없이 로컬 달력 날짜 사이의 날 수를 세요. */
function calendarDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

export function fromLine(item: Pick<InboxItemView, 'from' | 'createdAt'>, now: Date): string {
  const received = new Date(item.createdAt);
  const gap = calendarDay(now) - calendarDay(received);
  const day =
    gap === 0
      ? '오늘'
      : gap === 1
        ? '어제'
        : `${received.getFullYear() === now.getFullYear() ? '' : `${received.getFullYear()}년 `}${monthDay(received)}`;
  const hour = received.getHours();
  const time = `${hour < 12 ? '오전' : '오후'} ${hour % 12 || 12}:${String(received.getMinutes()).padStart(2, '0')}`;
  return `${item.from ?? '이름 없는 연결'} · ${day} ${time}`;
}

export function scopeLabel(scopes: readonly AgentTokenView['scopes'][number][]): string {
  return [
    scopes.includes('inbox:write') ? '받은함' : '',
    scopes.includes('share:create') ? '짧은 링크' : '',
    scopes.includes('library:read') && scopes.includes('library:write') ? '보관함' : '',
  ]
    .filter(Boolean)
    .join('·');
}

export function expiryLabel(expiresAt: number, now: Date): string {
  if (expiresAt < now.getTime()) return '만료됨';
  const expires = new Date(expiresAt);
  const days = calendarDay(expires) - calendarDay(now);
  return `만료 ${monthDay(expires)}(${days === 0 ? '오늘' : `${days}일 남음`})`;
}

export function lastUsedLabel(lastUsedAt: number | null, now: Date): string {
  if (lastUsedAt === null) return '없음';
  const used = new Date(lastUsedAt);
  const gap = calendarDay(now) - calendarDay(used);
  return gap === 0 ? '오늘' : gap === 1 ? '어제' : monthDay(used);
}

const KIND_NAMES: Record<string, string> = {
  label: '라벨',
  place: '장소',
  folder: '폴더',
  trip: '여행',
  meeting: '모임',
};

export function changeTitle(change: AgentChangeView): string {
  return `${KIND_NAMES[change.kind] ?? '항목'} · ${change.label}`;
}

export function changeLine(change: AgentChangeView, now: Date): string {
  const line = fromLine({ from: change.tokenName, createdAt: change.at }, now);
  return change.undoneAt === null ? line : `${line} · 되돌림`;
}
