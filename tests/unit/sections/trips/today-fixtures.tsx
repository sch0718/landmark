import { screen, within } from '@testing-library/react';
import type { Library, Place } from 'src/schema/library';
import { f, fakeRoutes, makeTrip, open, plannerLibrary, TRIP, withTrip } from './planner-fixtures';

// 여행 당일 모드 화면 테스트가 함께 쓰는 여행·장소·화면 도우미. 장소·가짜 경로는 계획 화면의 것을 그대로 쓴다.

export { fakeRoutes, makeTrip, plannerLibrary, TRIP, withTrip };

/** 테스트의 "지금": 2026-10-24(토) 10:00. 여행은 2026-10-24~26(3일). */
export const NOW = new Date(2026, 9, 24, 10, 0);
export const TRIP_START = '2026-10-24';

/** 2026-10-24부터 3일짜리 여행. 나머지 옵션은 `makeTrip`과 같다. */
export const todayTrip = (options: Parameters<typeof makeTrip>[0] = {}) =>
  makeTrip({ start: TRIP_START, days: 3, ...options });

/** 장소의 다녀온 날(`visitedOn`)을 바꾼다. */
export function withVisited(lib: Library, placeId: string, visitedOn: string | null): Library {
  const place: Place = { ...lib.places[placeId]!, visitedOn: f<string | null>(visitedOn) };
  return { ...lib, places: { ...lib.places, [placeId]: place } };
}

/** 장소를 보관함에서 지운다(묘비). */
export function withDeleted(lib: Library, placeId: string): Library {
  const place: Place = { ...lib.places[placeId]!, deletedAt: '2026-10-24T00:30:00.000Z' };
  return { ...lib, places: { ...lib.places, [placeId]: place } };
}

/** 당일 모드 화면(`/trips/<id>/today`)을 실제 라우트 표·jotai 저장소·앱 런타임으로 그린다. 기본 폭은 휴대폰(390). */
export function renderToday(
  lib: Library,
  options: { path?: string; width?: number; routes?: ReturnType<typeof fakeRoutes> } = {},
) {
  return open(lib, {
    path: options.path ?? `/trips/${TRIP}/today`,
    width: options.width ?? 390,
    routes: options.routes,
  });
}

export const nextCard = () => screen.getByRole('region', { name: '다음 장소' });
export const remainingList = () => screen.getByRole('list', { name: '남은 일정' });
export const remainingRows = () => within(remainingList()).getAllByRole('listitem');
export const notices = () => screen.queryAllByRole('status');
