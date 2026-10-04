/**
 * LWW(마지막 쓰기 승리). `updatedAt`이 큰 쪽을 택하고, 같으면 JSON 직렬화 문자열을
 * 사전순 비교해 큰 쪽을 택한다(결정적 타이브레이크). 직렬화까지 같으면 `a`를 반환한다.
 */
export function pickLww<T extends { updatedAt: string }>(
  a: T | undefined,
  b: T | undefined,
): T | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}
