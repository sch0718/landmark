/**
 * 연결된 입력장치가 모두 터치뿐인가(마우스·터치패드·펜처럼 올려 둘 수 있는 장치가 하나도 없다).
 * `hover`·`pointer`는 주 입력장치만 보므로 마우스를 함께 쓰는 터치 기기를 잘못 고른다. `any-*`로 전부를 본다.
 */
export const TOUCH_ONLY_QUERY = '(any-hover: none) and (any-pointer: coarse)';

/** 터치 전용 기기인가. 알 수 없으면(`matchMedia` 없음) 아니라고 본다. 지도를 만들 때 한 번만 본다. */
export function isTouchOnly(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(TOUCH_ONLY_QUERY).matches;
}
