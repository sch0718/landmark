function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function newToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return base64url(new Uint8Array(digest));
}

export function hashIp(ip: string, salt: string): Promise<string> {
  // 두 입력의 경계를 보존해 소금과 IP가 섞이지 않게 한다.
  return hashToken(JSON.stringify([salt, ip]));
}
