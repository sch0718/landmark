/** `2026.10.13`(로컬 날짜). 입력은 읽을 때 검증한 ISO 시각이다. */
export function localDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}
