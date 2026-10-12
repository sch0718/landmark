import { formatSpan, type DaySchedule } from 'src/domain/trips/schedule';

/** 구간 시간: 초 → `12분`·`1시간 20분`. 0초보다 길면 적어도 1분으로 보인다. */
export function formatDuration(seconds: number): string {
  if (!(seconds > 0)) return '0분';
  return formatSpan(Math.max(1, Math.round(seconds / 60)));
}

/** 거리: 1km 미만 `850m`, 10km 미만 소수 한 자리 `1.1km`(`.0`은 뗀다), 그 위는 `54km`. */
export function formatDistance(meters: number): string {
  if (!(meters > 0)) return '0m';
  if (Math.round(meters) < 1000) return `${Math.round(meters)}m`;
  const km = meters / 1000;
  if (km < 10) {
    const tenth = Math.round(km * 10) / 10;
    return `${Number.isInteger(tenth) ? tenth.toFixed(0) : tenth.toFixed(1)}km`;
  }
  return `${Math.round(km)}km`;
}

/** 그날 합계: `이동 1시간 20분 · 54km · 통행료 3,000원`. 통행료가 0이면 빼고, 추정이 섞이면 앞에 `약`. */
export function formatTotals(totals: DaySchedule['totals']): string {
  const parts = [`이동 ${formatDuration(totals.travelS)}`, formatDistance(totals.distanceM)];
  if (totals.tollFare > 0) parts.push(`통행료 ${totals.tollFare.toLocaleString('ko-KR')}원`);
  return `${totals.approximate ? '약 ' : ''}${parts.join(' · ')}`;
}

/** 조회 날짜(이 기기 시간대): `10월 12일 조회`. */
export function queriedLabel(iso: string): string {
  const date = new Date(iso);
  return `${date.getMonth() + 1}월 ${date.getDate()}일 조회`;
}

// 숫자로 끝나는 이름의 받침: 0(영)·1(일)·3(삼)·6(육)·7(칠)·8(팔)은 받침이 있다.
const DIGIT_HAS_FINAL = new Set(['0', '1', '3', '6', '7', '8']);

/** 목적격 조사: 받침이 있으면 `을`, 없으면 `를`. 한글·숫자가 아닌 글자로 끝나면 `을`. */
export function objectParticle(word: string): '을' | '를' {
  const last = word.trimEnd().at(-1);
  if (last === undefined) return '을';
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 0 ? '를' : '을';
  if (/\d/.test(last)) return DIGIT_HAS_FINAL.has(last) ? '을' : '를';
  return '을';
}
