const DAY_MS = 86_400_000;

/** `start`~`end`의 날 수. 양 끝을 포함하므로 같은 날이면 1. UTC 자정 기준이라 시간대·서머타임에 흔들리지 않는다. */
export function daysBetween(start: string, end: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((toUtc(end) - toUtc(start)) / DAY_MS) + 1;
}

/** 'YYYY-MM-DD'에 `n`일을 더한다. UTC 자정 기준이라 서머타임에 흔들리지 않는다. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!) + n * DAY_MS);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
