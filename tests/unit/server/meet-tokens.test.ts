// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashIp, hashToken, newToken } from 'src/server/meet/tokens';

describe('newToken', () => {
  it('32바이트를 패딩 없는 43자 base64url로 만든다', () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('부를 때마다 다른 토큰을 만든다', () => {
    const tokens = Array.from({ length: 100 }, () => newToken());
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

describe('hashToken', () => {
  it.each(['시험 토큰', 'abc'])('%s의 SHA-256을 base64url로 돌려준다', async (token) => {
    const hash = await hashToken(token);
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(createHash('sha256').update(token).digest('base64url'));
    expect(await hashToken(token)).toBe(hash);
    expect(hash).not.toBe(token);
    expect(await hashToken(`${token}다름`)).not.toBe(hash);
  });
});

describe('hashIp', () => {
  it('같은 IP·소금은 같은 해시이고 소금이 다르면 다르다', async () => {
    const hash = await hashIp('192.0.2.1', '시험 소금1');
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await hashIp('192.0.2.1', '시험 소금1')).toBe(hash);
    expect(await hashIp('192.0.2.1', '시험 소금2')).not.toBe(hash);
    expect(hash).not.toContain('192.0.2.1');
  });

  it('소금이 같아도 IP가 다르면 해시가 다르다', async () => {
    expect(await hashIp('192.0.2.1', '시험 소금')).not.toBe(await hashIp('192.0.2.2', '시험 소금'));
  });

  it('소금과 IP를 단순히 이어 붙인 값이 같아도 구분한다', async () => {
    expect(await hashIp('bc', 'a')).not.toBe(await hashIp('c', 'ab'));
  });
});
