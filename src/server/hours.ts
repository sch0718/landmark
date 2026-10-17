// 네이버 장소 홈 HTML에서 요일별 영업시간을 읽어 앱이 쓰기 좋은 모양으로 정리한다(스펙 §4.1).
// Cloudflare 서버 함수에서도 쓰므로 상대 경로 import만 쓰고 브라우저·React 코드를 끌어오지 않는다.
import { ApiError } from './http';
import { BROWSER_USER_AGENT, makeRequester, type Deps } from './request';

/** 'HH:mm'. 끝 시각만 '24:00'이 올 수 있다. */
export type HoursSpan = { start: string; end: string };
export type HoursDay = {
  /** 네이버 표기 그대로('월'~'일', '매일', 그 밖도 그대로). */
  day: string;
  /** 휴무 요일·읽지 못한 시각은 null. */
  open: (HoursSpan & { endsNextDay: boolean }) | null;
  /** 네이버 시각이 null이고 설명에 '휴무'가 들어 있다. 시각을 못 읽었을 뿐이면 false(→ 모름). */
  closed: boolean;
  breaks: HoursSpan[];
  /** 라스트오더 시각들(읽을 수 있는 것만). */
  lastOrders: string[];
  /** 예: '정기휴무 (매주 수요일)'. */
  note: string | null;
};
export type PlaceHours = {
  sid: string;
  /** 서버가 네이버에서 받은 시각(ISO). */
  fetchedAt: string;
  /** 첫 운영 시간 항목. 네이버에 영업시간이 없으면 빈 배열. */
  days: HoursDay[];
  irregularClosed: string[];
  regularClosed: string | null;
  /** freeText. 빈 문자열은 null. */
  note: string | null;
  /** 둘째 항목부터의 이름(빈 이름은 뺀다). */
  otherSchedules: string[];
};

const SID = /^\d{1,15}$/;
const HOME_HOST = 'pcmap.place.naver.com';
const MAX_REDIRECTS = 2;
const STATE_MARKER = '__APOLLO_STATE__';
const KEY_MARKER = '"newBusinessHours":';
const START = /^([01]\d|2[0-3]):[0-5]\d$/;
const NAVER_HEADERS = {
  'User-Agent': BROWSER_USER_AGENT,
  'Accept-Language': 'ko-KR,ko;q=0.9',
  Referer: 'https://map.naver.com/',
};

const badResponse = (message = '네이버 영업시간 응답을 읽지 못함') =>
  new ApiError('UPSTREAM_ERROR', message);

/** `?sid=<네이버 장소 ID>`를 읽는다. 숫자 1~15자리가 아니면 BAD_REQUEST. */
export function parseHoursQuery(url: URL): string {
  const sid = url.searchParams.get('sid');
  if (sid === null || !SID.test(sid)) throw new ApiError('BAD_REQUEST', 'sid는 숫자 1~15자리');
  return sid;
}

/** `[` 위치에서 시작해 짝이 맞는 `]` 다음 위치를 돌려준다. 문자열 안의 괄호·이스케이프는 세지 않는다. 없으면 -1. */
function matchingBracketEnd(text: string, from: number): number {
  let depth = 0;
  let inString = false;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * 장소 홈 HTML에서 `"newBusinessHours":` 값을 꺼낸다. 값은 배열이거나 `null`이다.
 * 상태 객체 뒤에 다른 스크립트가 붙어 있어 `</script>`까지 잘라 읽을 수 없으므로 배열만 괄호를 맞춰 뗀다.
 * 상태나 키가 없으면 요청이 막혀 다른 HTML이 온 것이라 UPSTREAM_ERROR(정보 없음 `[]`/`null`과 구별한다).
 */
export function extractBusinessHours(html: string): unknown[] | null {
  const stateAt = html.indexOf(STATE_MARKER);
  if (stateAt < 0) throw badResponse('네이버 장소 홈에 상태 객체가 없음');
  const keyAt = html.indexOf(KEY_MARKER, stateAt);
  if (keyAt < 0) throw badResponse('네이버 장소 홈에 영업시간 키가 없음');

  let start = keyAt + KEY_MARKER.length;
  while (start < html.length && /\s/.test(html[start]!)) start += 1;

  if (html.startsWith('null', start)) return null;
  if (html[start] !== '[') throw badResponse('영업시간 값이 배열이 아님');
  const end = matchingBracketEnd(html, start);
  if (end < 0) throw badResponse('영업시간 배열의 닫는 괄호가 없음');

  let parsed: unknown;
  try {
    parsed = JSON.parse(html.slice(start, end));
  } catch {
    throw badResponse('영업시간 배열이 JSON이 아님');
  }
  if (!Array.isArray(parsed)) throw badResponse('영업시간 값이 배열이 아님');
  return parsed;
}

type Raw = Record<string, unknown>;
const asRecord = (value: unknown): Raw | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : undefined;
const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
const isStart = (value: unknown): value is string => typeof value === 'string' && START.test(value);
const isEnd = (value: unknown): value is string => value === '24:00' || isStart(value);

function toSpan(value: unknown): HoursSpan | null {
  const raw = asRecord(value);
  return raw && isStart(raw.start) && isEnd(raw.end) ? { start: raw.start, end: raw.end } : null;
}

function toDay(value: unknown): HoursDay | null {
  const raw = asRecord(value);
  if (!raw || typeof raw.day !== 'string') return null;
  const span = toSpan(raw.businessHours);
  const note = asText(raw.description);
  return {
    day: raw.day,
    open: span ? { ...span, endsNextDay: raw.showEndsNextDay === true } : null,
    // 시각이 아예 없는(null) 요일의 설명에 '휴무'가 있을 때만 휴무다. 시각을 못 읽은 경우는 모름으로 둔다.
    closed: (raw.businessHours ?? null) === null && note !== null && note.includes('휴무'),
    breaks: (Array.isArray(raw.breakHours) ? raw.breakHours : [])
      .map(toSpan)
      .filter((s): s is HoursSpan => s !== null),
    lastOrders: (Array.isArray(raw.lastOrderTimes) ? raw.lastOrderTimes : [])
      .map((item) => asRecord(item)?.time)
      .filter(isStart),
    note,
  };
}

/** 임시 휴무 원문 하나. 객체면 문자열 값만 이어 붙인다. 읽을 게 없으면 null. */
function irregularText(value: unknown): string | null {
  if (typeof value === 'string') return asText(value);
  const raw = asRecord(value);
  if (!raw) return null;
  return asText(
    Object.values(raw)
      .filter((v): v is string => typeof v === 'string')
      .join(' '),
  );
}

/** 원본 배열을 `PlaceHours`로 정리한다. 첫 항목으로 계산하고 둘째부터는 이름만 모은다. 읽지 못한 부분은 버린다. */
export function toPlaceHours(sid: string, raw: unknown[] | null, fetchedAt: string): PlaceHours {
  const items = raw ?? [];
  const first = asRecord(items[0]);
  return {
    sid,
    fetchedAt,
    days: (Array.isArray(first?.businessHours) ? first.businessHours : [])
      .map(toDay)
      .filter((d): d is HoursDay => d !== null),
    irregularClosed: (Array.isArray(first?.comingIrregularClosedDays)
      ? first.comingIrregularClosedDays
      : []
    )
      .map(irregularText)
      .filter((t): t is string => t !== null),
    regularClosed: asText(first?.comingRegularClosedDays),
    note: asText(first?.freeText),
    otherSchedules: items
      .slice(1)
      .map((item) => asText(asRecord(item)?.name))
      .filter((name): name is string => name !== null),
  };
}

/**
 * 이동 응답의 다음 주소. `https://pcmap.place.naver.com/<영문 소문자>/<같은 sid>/home`만 받고
 * 쿼리·해시는 버린다. 그 밖은 UPSTREAM_ERROR.
 */
function nextHomeUrl(location: string | null, current: URL, sid: string): string {
  if (location === null || location === '') throw badResponse('이동 응답에 Location이 없음');
  let next: URL;
  try {
    next = new URL(location, current);
  } catch {
    throw badResponse('이동 주소를 읽지 못함');
  }
  const allowed =
    next.protocol === 'https:' &&
    next.hostname === HOME_HOST &&
    next.port === '' &&
    next.username === '' &&
    next.password === '' &&
    new RegExp(`^/[a-z]+/${sid}/home$`).test(next.pathname);
  if (!allowed) throw badResponse('예상하지 못한 곳으로 이동함');
  return `https://${HOME_HOST}${next.pathname}`;
}

/**
 * 장소 홈을 받아 영업시간을 읽는다. `/place/<sid>/home`은 식당·카페면 `/restaurant/…`로 이동하므로
 * 최대 2번 따라간다. 네이버 404는 NOT_FOUND, 상태나 키가 없는 HTML은 UPSTREAM_ERROR.
 */
export async function resolveHours(
  sid: string,
  deps: Deps,
  now: () => Date = () => new Date(),
): Promise<PlaceHours> {
  const request = makeRequester(deps);
  let url = `https://${HOME_HOST}/place/${sid}/home`;
  for (let hops = 0; ; hops += 1) {
    const res = await request(url, { headers: NAVER_HEADERS }, { acceptRedirect: true });
    if (res.status < 300 || res.status >= 400) {
      const raw = extractBusinessHours(await res.text());
      return toPlaceHours(sid, raw, now().toISOString());
    }
    if (hops === MAX_REDIRECTS) throw badResponse('이동이 너무 많음');
    url = nextHomeUrl(res.headers.get('Location'), new URL(url), sid);
  }
}
