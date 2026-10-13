import { daysBetween } from 'src/schema/trip';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;
const DAY_MS = 86_400_000;

const parts = (date: string): [number, number, number] => {
  const [y, m, d] = date.split('-').map(Number);
  return [y!, m!, d!];
};

/** 'YYYY-MM-DD'에 `n`일을 더한다. UTC 자정 기준이라 서머타임에 흔들리지 않는다. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = parts(date);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

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
