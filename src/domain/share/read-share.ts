import { decodeCompressedJson } from 'src/domain/codec';
import { safeParse } from 'src/schema/parse';
import { checkShareTrip } from 'src/domain/share/check-share-trip';
import { ShareDocSchema, ShareDocV2Schema, type ShareDoc } from 'src/schema/share';

/** 받은 공유 파일·링크를 읽을 때의 한도. */
export const SHARE_IMPORT_LIMITS = {
  fileBytes: 5_242_880,
  places: 1000,
  hashChars: 32_000,
  decodedBytes: 5_242_880,
} as const;

/** 공유 링크에서 압축 데이터 앞에 붙는 접두사. */
export const SHARE_HASH_PREFIX = '#d=';

export type ShareReadError = 'too-big' | 'not-share' | 'corrupt' | 'empty' | 'too-many' | 'newer';

export const SHARE_READ_MESSAGES: Record<ShareReadError, string> = {
  'too-big': '파일이 너무 커요',
  'not-share': 'Landmark 공유 파일이 아니에요',
  corrupt: '공유 파일을 읽지 못했어요. 파일이나 링크가 손상됐을 수 있어요',
  empty: '가져올 장소가 없는 파일이에요',
  'too-many': '장소가 너무 많은 파일이에요(최대 1,000곳)',
  newer: '새 버전 Landmark에서 만든 파일이에요. 앱을 새로 고친 뒤 다시 열어 주세요',
};

export type ShareReadResult = { ok: true; doc: ShareDoc } | { ok: false; error: ShareReadError };

const fail = (error: ShareReadError): ShareReadResult => ({ ok: false, error });

const hasDuplicateId = (items: readonly { id: string }[]): boolean =>
  new Set(items.map((item) => item.id)).size !== items.length;

/** 이 앱이 모르는 더 새 형식(version 3 이상)인지. 다른 검사보다 먼저 본다. */
const isNewerVersion = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  const { format, version } = value as { format?: unknown; version?: unknown };
  return (
    format === 'tripmap-share' &&
    typeof version === 'number' &&
    Number.isFinite(version) &&
    version >= 3
  );
};

/**
 * 파일·해시 공통 검사. 더 새 버전(newer) → 스키마(모르는 필드 거절) → 장소·라벨 id 겹침
 * → 장소 0곳 → (v2만) 여행 관계 검사 → 장소 한도 초과.
 * 내보내기는 id가 겹치는 파일을 만들지 않으므로, 겹치면 손상된 파일로 본다.
 */
function validate(value: unknown): ShareReadResult {
  if (isNewerVersion(value)) return fail('newer');
  const isV2 = (value as { version?: unknown } | null)?.version === 2;
  const parsed = isV2
    ? safeParse(ShareDocV2Schema, value, { onExcessProperty: 'error' })
    : safeParse(ShareDocSchema, value, { onExcessProperty: 'error' });
  if (!parsed.success) return fail('corrupt');
  const doc: ShareDoc = parsed.data;
  if (hasDuplicateId(doc.places) || hasDuplicateId(doc.labels)) return fail('corrupt');
  if (doc.places.length === 0) return fail('empty');
  if (doc.version === 2 && checkShareTrip(doc).length > 0) return fail('corrupt');
  if (doc.places.length > SHARE_IMPORT_LIMITS.places) return fail('too-many');
  return { ok: true, doc };
}

/** 공유 파일(HTML)의 텍스트에서 `#tripmap-share` 데이터 블록을 읽는다. 스크립트는 실행되지 않는다. */
export function readShareHtml(text: string): ShareReadResult {
  // 같은 id의 다른 요소(예: 앞에 놓인 `<div>`)가 아니라 데이터 스크립트만 본다.
  const block = new DOMParser()
    .parseFromString(text, 'text/html')
    .querySelector('script[type="application/json"]#tripmap-share');
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
