import { autoMode, haversineM } from 'src/domain/trips/geo';
import type { Place } from 'src/schema/library';
import type { GeoFix } from 'src/services/geolocation';
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
 * 출발점과 구간은 `directionsFrom`이 함께 정한 것(`origin`)을 받는다. 수단은 그 구간 수단, 구간이 없으면
 * 직선거리로 `autoMode`(800m 이하 도보, 그 밖 자동차). 출발점을 모르거나 주소를 만들 수 없으면 null.
 */
export function todayDirections(args: {
  to: Place;
  origin: DirectionsOrigin | null;
  platform: 'app' | 'web';
}): string | null {
  const { to, origin, platform } = args;
  if (origin === null) return null;
  const { from, leg } = origin;
  const mode = leg?.mode ?? autoMode(haversineM([from.lng, from.lat], [to.lng, to.lat]));
  return naverDirectionsUrl({ from, to: pointOf(to), mode }, platform);
}

/** 길찾기 출발점의 이름(쓸 수 있는 내 위치에서 나설 때). */
export const MY_LOCATION_NAME = '내 위치';

type ModelPoints = Pick<TodayModel, 'start' | 'stops'>;

/**
 * 도착 바로 앞의 지점(스펙 §4.6·§4.8의 앞 지점): 직전 Stop → 그날 출발점. 첫 Stop이고 출발점이 없으면 null.
 * `'end'`(숙소)는 그날 마지막 Stop → 출발점. "앞 지점이 있는가"는 늦어짐·어림·길찾기가 모두 이 규칙을 쓴다.
 */
export function pointBefore(model: ModelPoints, target: DirectionsTarget): Place | null {
  const index = target === 'end' ? model.stops.length : target;
  return (index > 0 ? model.stops[index - 1]?.place : model.start) ?? null;
}

/**
 * 앞 지점에서 도착까지의 계획 구간(수단을 따르려고). 구간은 `[출발점?, …Stop, 도착점?]`의 인접 쌍 순서다.
 * 앞 지점이 없거나 도착점이 없는데 `'end'`를 물으면 null.
 */
export function legInto(
  model: ModelPoints & Pick<TodayModel, 'end' | 'plan'>,
  target: DirectionsTarget,
): PlannedLeg | null {
  if (target === 'end' && model.end === null) return null;
  if (pointBefore(model, target) === null) return null;
  const index = target === 'end' ? model.stops.length : target;
  return model.plan.legs[(model.start === null ? 0 : 1) + index - 1] ?? null;
}

/** 길찾기의 출발점과 그 출발점에서 나서는 계획 구간(없으면 직선거리로 수단을 고른다). */
export type DirectionsOrigin = { from: DirectionsFrom; leg: PlannedLeg | null };

/**
 * 길찾기 출발점(스펙 §4.8): 쓸 수 있는 내 위치(`fix`, 이름 `내 위치`) → 앞 지점. 둘 다 없으면 null.
 * 출발점과 구간을 함께 정한다 — 내 위치에서 나서면 계획 구간은 다른 곳에서 시작하므로 쓰지 않는다(`leg: null`,
 * 수단은 내 위치에서 도착까지의 직선거리로 `autoMode`).
 */
export function directionsFrom(
  model: ModelPoints & Pick<TodayModel, 'end' | 'plan'>,
  target: DirectionsTarget,
  fix?: GeoFix | null,
): DirectionsOrigin | null {
  if (fix !== undefined && fix !== null) {
    return { from: { name: MY_LOCATION_NAME, lng: fix.lng, lat: fix.lat }, leg: null };
  }
  const previous = pointBefore(model, target);
  return previous === null ? null : { from: pointOf(previous), leg: legInto(model, target) };
}
