const CATEGORY_PALETTE = [
  '#e53935',
  '#fb8c00',
  '#fdd835',
  '#43a047',
  '#00acc1',
  '#1e88e5',
  '#8e24aa',
  '#d81b60',
] as const;
const DAY_PALETTE = [
  '#1e88e5',
  '#e53935',
  '#43a047',
  '#fb8c00',
  '#8e24aa',
  '#00acc1',
  '#6d4c41',
  '#d81b60',
] as const;
export const NO_CATEGORY_COLOR = '#9e9e9e';

/** 카테고리 문자열 해시(djb2)로 고정 팔레트(8색)에서 고른다. null은 회색. */
export function categoryColor(category: string | null): string {
  if (category === null) return NO_CATEGORY_COLOR;
  let h = 5381;
  for (let i = 0; i < category.length; i++) h = (h * 33 + category.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length]!;
}

/** 날짜 순번(0부터)별 색. 팔레트보다 많으면 순환한다. */
export function dayColor(index: number): string {
  const n = DAY_PALETTE.length;
  return DAY_PALETTE[((Math.trunc(index) % n) + n) % n]!;
}
