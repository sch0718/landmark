const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
// 256 이하의 36 배수 중 가장 큰 값. 이 값 이상의 바이트는 버려서 `% 36` 편향을 없앤다.
const BYTE_LIMIT = 252;

export function randomId(length: number): string {
  let id = '';
  while (id.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte >= BYTE_LIMIT) continue;
      id += ALPHABET[byte % ALPHABET.length];
      if (id.length === length) break;
    }
  }
  return id;
}

export function randomToken(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
