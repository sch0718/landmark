export type CodecErrorCode = 'too-long' | 'too-large' | 'corrupt';

export class CodecError extends Error {
  readonly code: CodecErrorCode;

  constructor(code: CodecErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CodecError';
    this.code = code;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new CodecError('corrupt', 'base64url 문자가 아닙니다');
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    throw new CodecError('corrupt', 'base64 해독에 실패했습니다');
  }
}

/** 값을 JSON → deflate-raw → base64url로 만든다. 길이 한도는 두지 않는다(호출자 몫). */
export async function encodeCompressedJson(value: unknown): Promise<string> {
  const input = bytesStream(new TextEncoder().encode(JSON.stringify(value)));
  const reader = input.pipeThrough(new CompressionStream('deflate-raw')).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.byteLength;
  }
  return toBase64Url(concat(parts, size));
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

/**
 * `encodeCompressedJson`의 역. 한도를 넘으면 `CodecError('too-long' | 'too-large')`, 그 밖의 실패는 `'corrupt'`.
 * 스키마 검증은 하지 않는다(호출자 몫).
 */
export async function decodeCompressedJson(
  value: string,
  limits: { maxChars: number; maxBytes: number },
): Promise<unknown> {
  if (value.length > limits.maxChars) throw new CodecError('too-long');
  const bytes = fromBase64Url(value);

  const stream = bytesStream(bytes).pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      total += chunk.byteLength;
      if (total > limits.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new CodecError('too-large');
      }
      chunks.push(chunk);
    }
  } catch (e) {
    if (e instanceof CodecError) throw e;
    throw new CodecError('corrupt', '압축 해제에 실패했습니다');
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(concat(chunks, total)));
  } catch {
    throw new CodecError('corrupt', 'JSON 해석에 실패했습니다');
  }
}
