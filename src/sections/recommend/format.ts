export function formatPeriod(start: string, end: string): string {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const format = (date: string) => (sameYear ? date.slice(5) : date).replaceAll('-', '.');
  return `${format(start)}–${format(end)}`;
}
