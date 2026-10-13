import { decodeCompressedJson } from 'src/domain/codec';
import { safeParse } from 'src/schema/parse';
import { ShareDocSchema, type ShareDoc } from 'src/schema/share';

/** 받은 공유 파일·링크를 읽을 때의 한도. */
export const SHARE_IMPORT_LIMITS = {
  fileBytes: 5_242_880,
  places: 1000,
  hashChars: 32_000,
  decodedBytes: 5_242_880,
} as const;

/** 공유 링크에서 압축 데이터 앞에 붙는 접두사. */
export const SHARE_HASH_PREFIX = '#d=';

export type ShareReadError = 'too-big' | 'not-share' | 'corrupt' | 'empty' | 'too-many';

export const SHARE_READ_MESSAGES: Record<ShareReadError, string> = {
  'too-big': '파일이 너무 커요',
  'not-share': 'Landmark 공유 파일이 아니에요',
  corrupt: '공유 파일을 읽지 못했어요. 파일이나 링크가 손상됐을 수 있어요',
  empty: '가져올 장소가 없는 파일이에요',
  'too-many': '장소가 너무 많은 파일이에요(최대 1,000곳)',
};

export type ShareReadResult = { ok: true; doc: ShareDoc } | { ok: false; error: ShareReadError };

const fail = (error: ShareReadError): ShareReadResult => ({ ok: false, error });

/** 파일·해시 공통 검사: 스키마(모르는 필드 거절) → 장소 0곳 → 장소 한도 초과. */
function validate(value: unknown): ShareReadResult {
  const parsed = safeParse(ShareDocSchema, value, { onExcessProperty: 'error' });
  if (!parsed.success) return fail('corrupt');
  if (parsed.data.places.length === 0) return fail('empty');
  if (parsed.data.places.length > SHARE_IMPORT_LIMITS.places) return fail('too-many');
  return { ok: true, doc: parsed.data };
}

/** 공유 파일(HTML)의 텍스트에서 `#tripmap-share` 데이터 블록을 읽는다. 스크립트는 실행되지 않는다. */
export function readShareHtml(text: string): ShareReadResult {
  const block = new DOMParser().parseFromString(text, 'text/html').getElementById('tripmap-share');
  if (!block) return fail('not-share');
  let json: unknown;
  try {
    json = JSON.parse(block.textContent ?? '');
  } catch {
    return fail('corrupt');
  }
  return validate(json);
}

/** 크기를 먼저 보고, 한도 안일 때만 내용을 읽는다. */
export async function readShareFile(file: Blob): Promise<ShareReadResult> {
  if (file.size > SHARE_IMPORT_LIMITS.fileBytes) return fail('too-big');
  let text: string;
  try {
    text = await file.text();
  } catch {
    return fail('corrupt');
  }
  return readShareHtml(text);
}

/** `value`는 `#d=` 뒤 부분. 압축 해제의 어떤 실패도 `corrupt`로 돌려준다. */
export async function readShareHash(value: string): Promise<ShareReadResult> {
  let json: unknown;
  try {
    json = await decodeCompressedJson(value, {
      maxChars: SHARE_IMPORT_LIMITS.hashChars,
      maxBytes: SHARE_IMPORT_LIMITS.decodedBytes,
    });
  } catch {
    return fail('corrupt');
  }
  return validate(json);
}
