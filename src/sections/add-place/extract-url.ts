/** 링크 후보: `http(s)://` 뒤로 공백 전까지. */
const URL_PATTERN = /https?:\/\/\S+/i;
/** 링크 끝에 붙어 오는 문장부호. 링크의 일부일 리 없다. */
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', "'", '"', '…', '。', '、']);
/** 닫는 괄호 → 여는 괄호. 링크 안에서 짝이 맞지 않는 닫는 괄호만 뗀다. */
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{', '>': '<' };

const count = (text: string, ch: string): number => text.split(ch).length - 1;

/**
 * 붙여 넣은 글에서 첫 `http(s)://` 링크를 뽑는다. 네이버 앱 "공유 → 복사"는
 * `[네이버 지도]\n콤포트\nhttps://naver.me/…`처럼 링크 앞뒤에 글자가 붙어 온다.
 * 끝에 붙은 문장부호와 짝 없는 닫는 괄호(`(링크).`)는 뗀다. 링크가 없으면 null.
 */
export function extractUrl(text: string): string | null {
  const found = URL_PATTERN.exec(text);
  if (found === null) return null;
  let url = found[0];
  for (;;) {
    const last = url.at(-1)!;
    const opener = CLOSERS[last];
    if (TRAILING_PUNCTUATION.has(last)) {
      url = url.slice(0, -1);
    } else if (opener !== undefined && count(url, last) > count(url, opener)) {
      url = url.slice(0, -1);
    } else {
      break;
    }
  }
  // 주소 부분이 없으면(`https://`만) 링크가 아니다.
  return /^https?:\/\/[^/?#]+/i.test(url) ? url : null;
}
