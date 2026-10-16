import { autoMode, haversineM } from 'src/domain/trips/geo';
import type { Place } from 'src/schema/library';
import { naverDirectionsUrl } from 'src/sections/trips/planner/naver-directions';
import type { PlannedLeg } from 'src/sections/trips/planner/use-day-plan';
import type { TodayModel } from 'src/sections/trips/today/use-today';

/** 길찾기 출발점: 이름과 좌표(WGS84). */
export type DirectionsFrom = { name: string; lng: number; lat: number };

/** 길찾기의 도착: 그날 Stop의 자리, 또는 그날 도착점(숙소)이면 `'end'`. */
export type DirectionsTarget = number | 'end';

const pointOf = (place: Place): DirectionsFrom => ({
  name: place.name.value,
  lng: place.lng,
  lat: place.lat,
});

/**
 * 다음 장소(고른 장소 포함)로 가는 길찾기 주소(스펙 §4.8). 좁은 화면은 앱(`nmap://`), 그 밖은 웹.
 * 수단은 계획의 그 구간 수단, 구간이 없으면 직선거리로 `autoMode`(800m 이하 도보, 그 밖 자동차).
 * 출발점을 모르거나 주소를 만들 수 없으면 null.
 */
export function todayDirections(args: {
  to: Place;
  from: DirectionsFrom | null;
  leg: PlannedLeg | null;
  platform: 'app' | 'web';
}): string | null {
  const { to, from, leg, platform } = args;
  if (from === null) return null;
  const mode = leg?.mode ?? autoMode(haversineM([from.lng, from.lat], [to.lng, to.lat]));
  return naverDirectionsUrl({ from, to: pointOf(to), mode }, platform);
}

/**
 * 도착 바로 앞의 지점(스펙 §4.8의 앞 지점): 직전 Stop → 그날 출발점. 첫 Stop이고 출발점이 없으면 null.
 * `'end'`(숙소)는 그날 마지막 Stop → 출발점. Task 5가 이 앞에 쓸 수 있는 내 위치를 끼운다.
 */
export function directionsFrom(model: TodayModel, target: DirectionsTarget): DirectionsFrom | null {
  const index = target === 'end' ? model.stops.length : target;
  const previous = index > 0 ? model.stops[index - 1]?.place : model.start;
  return previous === undefined || previous === null ? null : pointOf(previous);
}

/**
 * 앞 지점에서 도착까지의 계획 구간(수단을 따르려고). 구간은 `[출발점?, …Stop, 도착점?]`의 인접 쌍 순서다.
 * 앞 지점이 없거나 도착점이 없는데 `'end'`를 물으면 null.
 */
export function legInto(model: TodayModel, target: DirectionsTarget): PlannedLeg | null {
  if (target === 'end' && model.end === null) return null;
  const index = target === 'end' ? model.stops.length : target;
  const at = (model.start === null ? 0 : 1) + index - 1;
  return at >= 0 ? (model.plan.legs[at] ?? null) : null;
}
