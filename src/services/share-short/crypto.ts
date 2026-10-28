// 짧은 링크의 본문 암호화. 해시(base64url)를 압축 바이트로 되돌려 암호화해야 base64url이 두 번 늘지 않는다.
// 링크마다 새 키를 만들어 IV를 다시 쓰지 않는다. 키는 링크의 `#k=`에만 싣는다.

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptShareHash(hash: string): Promise<{ body: string; key: string }> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, fromBase64Url(hash)),
  );
  const body = new Uint8Array(iv.byteLength + sealed.byteLength);
  body.set(iv);
  body.set(sealed, iv.byteLength);
  return {
    body: toBase64Url(body),
    key: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', key))),
  };
}

/** 삭제 토큰(43자 base64url). */
export function newDeleteToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}
