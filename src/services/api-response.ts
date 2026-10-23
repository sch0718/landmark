/** 서버의 공통 오류 본문에서 코드를 읽는다. JSON이 아니거나 코드가 없으면 null. */
export function readApiErrorCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const error = body.error;
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : null;
}
