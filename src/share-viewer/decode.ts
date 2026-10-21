import type { ShareDoc } from 'src/schema/share';
import { MAX_HASH_CHARS } from './encode';
import { parseLinkDoc } from './parse';

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('base64url 문자가 아닙니다');
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    throw new Error('base64 해독에 실패했습니다');
  }
}

function bytesStream(bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array<ArrayBuffer>> {
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function concat(parts: Uint8Array[], size: number): Uint8Array {
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    merged.set(p, offset);
    offset += p.byteLength;
  }
  return merged;
}

/** 링크 해시를 크기 제한 안에서 풀고 검사한다. 어떤 실패도 null로 돌려준다. */
export async function decodeShareHash(value: string): Promise<ShareDoc | null> {
  try {
    if (value.length === 0 || value.length > MAX_HASH_CHARS) return null;
    const bytes = fromBase64Url(value);

    const stream = bytesStream(bytes).pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      total += chunk.byteLength;
      if (total > 5_242_880) {
        await reader.cancel().catch(() => undefined);
        throw new Error('풀린 데이터가 너무 커요');
      }
      chunks.push(chunk);
    }

    return parseLinkDoc(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(concat(chunks, total))),
    );
  } catch {
    return null;
  }
}
