import type { ShareDoc } from 'src/schema/share';

/** 틀(HTML)에서 데이터가 들어갈 자리. 정확히 하나만 있어야 한다. */
export const SHARE_DATA_PLACEHOLDER = '__TRIPMAP_DATA__';

// 소스에 U+2028/U+2029/`<`를 리터럴로 쓰면 편집 도구가 실제 문자로 바꿀 수 있어
// 정규식 문자열 안에서 백슬래시 이스케이프로만 쓴다.
const UNSAFE_IN_SCRIPT = new RegExp('[<\\u2028\\u2029]', 'g');

/** 문자를 백슬래시+`u`+16진수 4자리(6글자)로 바꾼다. JSON 문자열 안에서 원래 문자와 같은 뜻이다. */
function toUnicodeEscape(ch: string): string {
  return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
}

/**
 * 공유 데이터를 `<script type="application/json">` 안에 넣어도 안전한 JSON 문자열로 만든다.
 * `<`로 `</script>`나 `<!--`가 만들어지는 것과, 일부 엔진에서 줄 바꿈으로 취급되는
 * U+2028/U+2029를 이스케이프한다. `JSON.parse`로 읽으면 원래 값이 그대로 나온다.
 */
export function serializeShareDoc(doc: ShareDoc): string {
  return JSON.stringify(doc).replace(UNSAFE_IN_SCRIPT, toUnicodeEscape);
}

/** 틀의 데이터 자리에 공유 데이터를 넣는다. 자리가 정확히 1개가 아니면 틀이 잘못된 것이므로 던진다. */
export function injectShareDoc(template: string, doc: ShareDoc): string {
  const count = template.split(SHARE_DATA_PLACEHOLDER).length - 1;
  if (count !== 1) {
    throw new Error(`공유 틀의 데이터 자리가 ${count}개입니다(1개여야 함)`);
  }
  const json = serializeShareDoc(doc);
  // 함수 replacer: 데이터의 `$&`, `$1`, `$$`가 치환 패턴으로 해석되지 않게 한다.
  return template.replace(SHARE_DATA_PLACEHOLDER, () => json);
}

// 파일 이름에 못 쓰는 문자(경로 구분자·윈도우 예약 문자·제어 문자)와 공백.
// eslint-disable-next-line no-control-regex -- 제어 문자를 걸러내는 것이 목적이다
const UNSAFE_IN_FILE_NAME = /[\\/:*?"<>|\u0000-\u001f\s]+/g;

const MAX_TITLE_CODE_POINTS = 40;
const FALLBACK_NAME = 'landmark';

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * 내려받는 파일 이름. `<제목>-YYYYMMDD.html` (날짜는 로컬 기준).
 * 파일 이름에 못 쓰는 문자·공백은 `-`로 바꾸고, 제목이 비면 `landmark`를 쓴다.
 */
export function shareFileName(title: string, now: Date): string {
  const cleaned = title
    .replace(UNSAFE_IN_FILE_NAME, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  // 서로게이트 쌍이 깨지지 않게 코드 포인트 단위로 자른다.
  const cut = [...cleaned].slice(0, MAX_TITLE_CODE_POINTS).join('');
  // 자른 뒤 끝에 `-`·`.`이 남을 수 있어 한 번 더 걷어 낸다.
  const base = cut.replace(/^[-.]+|[-.]+$/g, '') || FALLBACK_NAME;
  const date = `${pad(now.getFullYear(), 4)}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}`;
  return `${base}-${date}.html`;
}
