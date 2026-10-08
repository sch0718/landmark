const METRO_SUFFIX = /(특별자치시|특별시|광역시)$/;
const CITY_COUNTY_SUFFIX = /[시군]$/;

/**
 * 주소에서 지역 이름을 뽑는다.
 * 첫 토큰이 특별시·광역시·특별자치시면 그 접미사를 뗀 이름, 아니면 두 번째 토큰에서
 * 시·군을 뗀 이름, 둘 다 아니면 `기타`.
 */
export function regionOf(address: string): string {
  const [first, second] = address.trim().split(/\s+/);
  if (first !== undefined && METRO_SUFFIX.test(first)) {
    const name = first.replace(METRO_SUFFIX, '');
    if (name !== '') return name;
  }
  if (second !== undefined && CITY_COUNTY_SUFFIX.test(second)) {
    const name = second.replace(CITY_COUNTY_SUFFIX, '');
    if (name !== '') return name;
  }
  return '기타';
}
