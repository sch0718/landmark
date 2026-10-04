import { LIMITS } from 'src/schema/common';

/** 내보내기 링크(§5.2). 편집은 프래그먼트에 실어 서버로 보내지 않는다. */
export function buildExportLink(origin: string, publicId: string, encoded: string): string {
  return `${origin}/t/${publicId}#e=${encoded}`;
}

/** 이 길이를 넘으면 링크 대신 파일 내보내기를 권한다. */
export function isLinkTooLong(link: string): boolean {
  return link.length > LIMITS.exportLinkWarnChars;
}

/** 받는 쪽이 읽을 수 있는 한도(LIMITS.linkChars)를 넘으면 링크로는 보낼 수 없다. 파일만 허용한다. */
export function isLinkOverLimit(link: string): boolean {
  return link.length > LIMITS.linkChars;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 파일 이름에 쓸 수 없는 문자만 `_`로 바꾼다. */
const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_');

/** `<제목>-<닉네임>-<YYYYMMDD>.tripedit.json`. 날짜는 현지 시각 기준. */
export function exportFileName(title: string, nickname: string, date: Date): string {
  const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return `${safe(title)}-${safe(nickname)}-${ymd}.tripedit.json`;
}
