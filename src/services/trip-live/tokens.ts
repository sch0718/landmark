/** 소유권 토큰은 URL 질의·보관함·백업에 넣지 않는다. */
export function newLiveToken(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function randomId(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  while (id.length < length)
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte >= 252) continue;
      id += alphabet[byte % 36];
      if (id.length === length) break;
    }
  return id;
}
export const newLiveId = (): string => randomId(10);
export const newDayId = (): string => randomId(8);
