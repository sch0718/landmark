import { atom } from 'jotai';

export type Mode = 'explore' | 'itinerary';

export type ViewMode = 'map' | 'day' | 'places';

export const viewModeAtom = atom<ViewMode>('map');
export type UiQuerySession = {
  owner: import('src/stores/trip-store').TripStore;
  load: import('src/stores/trip-store').LoadState;
  trip: import('src/schema/trip-data').TripData;
};
export const uiQueryReadyAtom = atom<UiQuerySession | false>(false);
export const modeAtom = atom(
  (get): Mode => (get(viewModeAtom) === 'day' ? 'itinerary' : 'explore'),
  (_get, set, value: Mode) => set(viewModeAtom, value === 'itinerary' ? 'day' : 'map'),
);
/** 선택한 날짜(`YYYY-MM-DD`) 또는 전체. URL의 `day`는 trip.days 순서의 1부터 번호다. */
export const selectedDayAtom = atom<string | 'all'>('all');
export const selectedPlaceAtom = atom<string | null>(null);
/** 상단 바 검색어. Task 17의 `ExploreFilter.query`로 전달한다. */
export const searchQueryAtom = atom('');

export type ViewQueryState = { view: ViewMode; day: string | 'all'; place: string | null };

export function isViewMode(value: unknown): value is ViewMode {
  return value === 'map' || value === 'day' || value === 'places';
}

/** URL 쿼리를 UI 상태로 해석한다. 알 수 없는 값은 기본값으로 둔다. */
export function parseViewQuery(
  params: URLSearchParams,
  dates: string[],
  fallback: ViewMode,
  today: string,
): ViewQueryState {
  const raw = params.get('view');
  const legacy = params.get('mode');
  const view: ViewMode = isViewMode(raw)
    ? raw
    : legacy === 'itinerary'
      ? 'day'
      : legacy === 'explore'
        ? 'map'
        : params.has('view') || params.has('mode')
          ? 'map'
          : fallback;
  const rawDay = params.get('day');
  const n = rawDay !== null && /^\d+$/.test(rawDay) ? Number(rawDay) : 0;
  const explicitDay = rawDay !== null;
  const legacyEntry = !isViewMode(raw) && legacy !== null;
  const day =
    n >= 1 && n <= dates.length
      ? dates[n - 1]!
      : explicitDay || legacyEntry || view !== 'day'
        ? 'all'
        : dates.includes(today)
          ? today
          : (dates[0] ?? 'all');
  return { view, day, place: params.get('place') || null };
}

/** UI 상태를 반영하고 무관한 쿼리는 보존한다. day의 전체 선택은 명시한다. */
export function buildViewQuery(
  current: URLSearchParams,
  state: ViewQueryState,
  dates: string[],
): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete('mode');
  next.set('view', state.view);
  const index = state.day === 'all' ? -1 : dates.indexOf(state.day);
  if (index >= 0) next.set('day', String(index + 1));
  else if (state.view === 'day' && state.day === 'all') next.set('day', 'all');
  else next.delete('day');
  if (state.place) next.set('place', state.place);
  else next.delete('place');
  return next;
}

export const viewStateKey = (s: ViewQueryState): string => JSON.stringify([s.view, s.day, s.place]);
