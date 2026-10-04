import { atom } from 'jotai';

export type Mode = 'explore' | 'itinerary';

export const modeAtom = atom<Mode>('explore');
/** 선택한 날짜(`YYYY-MM-DD`) 또는 전체. URL의 `day`는 trip.days 순서의 1부터 번호다. */
export const selectedDayAtom = atom<string | 'all'>('all');
export const selectedPlaceAtom = atom<string | null>(null);
/** 상단 바 검색어. Task 17의 `ExploreFilter.query`로 전달한다. */
export const searchQueryAtom = atom('');

export type UiQueryState = { mode: Mode; day: string | 'all'; place: string | null };

/** URL 쿼리를 UI 상태로 해석한다. 알 수 없는 값은 기본값으로 둔다. */
export function parseUiQuery(params: URLSearchParams, dates: string[]): UiQueryState {
  const mode: Mode = params.get('mode') === 'itinerary' ? 'itinerary' : 'explore';
  const dayParam = params.get('day');
  const n = dayParam !== null && /^\d+$/.test(dayParam) ? Number(dayParam) : 0;
  const day = n >= 1 && n <= dates.length ? dates[n - 1]! : 'all';
  const place = params.get('place') || null;
  return { mode, day, place };
}

/** UI 상태를 기존 쿼리에 반영한다. 기본값은 쿼리에서 뺀다. */
export function buildUiQuery(
  current: URLSearchParams,
  state: UiQueryState,
  dates: string[],
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (state.mode === 'itinerary') next.set('mode', 'itinerary');
  else next.delete('mode');
  const index = state.day === 'all' ? -1 : dates.indexOf(state.day);
  if (index >= 0) next.set('day', String(index + 1));
  else next.delete('day');
  if (state.place) next.set('place', state.place);
  else next.delete('place');
  return next;
}

export const uiStateKey = (s: UiQueryState): string => `${s.mode}|${s.day}|${s.place ?? ''}`;
