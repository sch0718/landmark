import type { Place } from 'src/schema/library';

// 다녀옴·한 줄 평을 읽고 다듬는 순수 도우미. 두 필드는 선택이라 없을 수 있다.

/** 다녀온 날(`YYYY-MM-DD`). 표시가 없으면 `null`. */
export function visitedOnOf(place: Place): string | null {
  return place.visitedOn?.value ?? null;
}

export function isVisited(place: Place): boolean {
  return visitedOnOf(place) !== null;
}

/** 한 줄 평. 없으면 빈 문자열. */
export function reviewOf(place: Place): string {
  return place.review?.value ?? '';
}

/** UTC ISO 시각을 기기 시간대의 달력 날짜(`YYYY-MM-DD`)로 바꾼다. 한국 00:30은 그날로 센다. */
export function localDateOf(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** 앞뒤 공백을 지우고, 줄바꿈 포함 연속 공백을 한 칸으로 줄여 한 줄로 만든다. */
export function normalizeReview(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** `2026-10-16` → `2026.10.16`. */
export function formatVisitDate(date: string): string {
  return date.replaceAll('-', '.');
}
