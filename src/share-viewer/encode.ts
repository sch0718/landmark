import type { ShareDoc } from 'src/schema/share';

/**
 * 보기 화면에서 앱으로 보내는 가져오기 링크 만들기.
 * 보기 화면 번들에는 Effect가 들어가면 안 되므로 `src/domain/codec.ts`를 가져오지 않고
 * 압축 부분만 여기에 따로 둔다(앱의 `readShareHash`가 읽는 것과 같은 형식: JSON → deflate-raw → base64url).
 */

export const DEFAULT_APP_URL = 'https://landmark-c5f.pages.dev';

/** 앱이 받아들이는 해시 값의 최대 길이(`SHARE_IMPORT_LIMITS.hashChars`와 같다). */
export const MAX_HASH_CHARS = 32_000;

/** 앱 주소. 비어 있으면 기본값, 끝의 `/`는 뗀다. */
export function appUrl(value: string | undefined): string {
  if (value === undefined || value === '') return DEFAULT_APP_URL;
  return value.replace(/\/+$/, '');
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 문서를 JSON → deflate-raw → base64url(`=` 없음)로 만든다. `CompressionStream`이 없으면 던진다. */
export async function encodeShareHash(doc: ShareDoc): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  const input = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = input.pipeThrough(new CompressionStream('deflate-raw')).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.byteLength;
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    merged.set(p, offset);
    offset += p.byteLength;
  }
  return toBase64Url(merged);
}

/**
 * 가져오기 링크에 실을 사본. v2는 경로선(`path`)을 뺀다 — 가져올 때 쓰지 않고 해시 길이만 늘리기 때문이다.
 * 시간·조회 시각은 남겨 문서 검사가 같게 한다. v1은 그대로 돌려준다.
 */
export function hashDoc(doc: ShareDoc): ShareDoc {
  if (doc.version !== 2) return doc;
  return {
    ...doc,
    trips: doc.trips.map((trip) => ({
      ...trip,
      days: trip.days.map((day) => ({
        ...day,
        legs: day.legs.map((leg) => ({ ...leg, path: [] })),
      })),
    })),
  };
}

export type ImportLink =
  { kind: 'direct'; href: string } | { kind: 'too-big'; href: string } | { kind: 'unsupported' };

/**
 * 문서를 담은 가져오기 링크(v2는 경로선을 뺀 사본 — `hashDoc`). 값이 `MAX_HASH_CHARS`를 넘으면 해시 없는 앱 주소만 돌려주고(`too-big`),
 * 이 브라우저에 압축 기능이 없거나 압축에 실패하면 `unsupported`.
 */
export async function importLink(doc: ShareDoc, app: string): Promise<ImportLink> {
  if (typeof CompressionStream === 'undefined') return { kind: 'unsupported' };
  let value: string;
  try {
    value = await encodeShareHash(hashDoc(doc));
  } catch {
    return { kind: 'unsupported' };
  }
  if (value.length > MAX_HASH_CHARS) return { kind: 'too-big', href: `${app}/import` };
  return { kind: 'direct', href: `${app}/import#d=${value}` };
}
