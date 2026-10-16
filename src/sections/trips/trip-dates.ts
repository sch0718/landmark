import { daysBetween } from 'src/schema/trip';

// `addDays`는 도메인에서도 쓰므로 스키마 쪽에 두고, 기존 import 경로를 위해 다시 내보낸다.
export { addDays } from 'src/schema/trip';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

const parts = (date: string): [number, number, number] => {
  const [y, m, d] = date.split('-').map(Number);
  return [y!, m!, d!];
};

/** `10.24(금)`. */
export function shortDate(date: string): string {
  const [y, m, d] = parts(date);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
  return `${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}(${weekday})`;
}

/** `10.24(금) ~ 10.26(일) · 2박 3일`. 하루면 `당일`. */
export function periodLabel(startDate: string, endDate: string): string {
  const days = daysBetween(startDate, endDate);
  const length = days <= 1 ? '당일' : `${days - 1}박 ${days}일`;
  return `${shortDate(startDate)} ~ ${shortDate(endDate)} · ${length}`;
}
