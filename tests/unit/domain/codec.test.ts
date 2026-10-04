import { describe, expect, it } from 'vitest';
import { CodecError, decodeEditLayer, encodeEditLayer } from 'src/domain/codec';
import { LIMITS } from 'src/schema/common';
import { makeEdit } from '../../fixtures/builders';

async function deflateRawBase64Url(text: string): Promise<string> {
  const src = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
  const reader = src.pipeThrough(new CompressionStream('deflate-raw')).getReader();
  const parts: number[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(...value);
  }
  const bytes = Uint8Array.from(parts);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return e instanceof CodecError ? e.code : 'other';
  }
  return undefined;
}

describe('편집 코덱', () => {
  it('왕복해도 같다', async () => {
    const edit = makeEdit({
      authors: { 'a-local': { nickname: '한글 닉네임', updatedAt: '2026-01-01T00:00:00.000Z' } },
    });
    const encoded = await encodeEditLayer(edit);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeEditLayer(encoded)).toEqual(edit);
  });

  it('16,001자는 too-long', async () => {
    expect(await codeOf(decodeEditLayer('A'.repeat(LIMITS.linkChars + 1)))).toBe('too-long');
  });

  it('해제 결과가 1MB를 넘으면 too-large', async () => {
    const json = `{"a":"${' '.repeat(2 * 1024 * 1024)}"}`;
    const encoded = await deflateRawBase64Url(json);
    expect(encoded.length).toBeLessThanOrEqual(LIMITS.linkChars);
    expect(await codeOf(decodeEditLayer(encoded))).toBe('too-large');
  });

  it('잘못된 문자는 corrupt', async () => {
    expect(await codeOf(decodeEditLayer('!!!'))).toBe('corrupt');
  });

  it('압축이 아닌 데이터와 JSON이 아닌 내용은 corrupt', async () => {
    expect(await codeOf(decodeEditLayer('AAAAAAAA'))).toBe('corrupt');
    expect(await codeOf(decodeEditLayer(await deflateRawBase64Url('not json')))).toBe('corrupt');
  });
});
