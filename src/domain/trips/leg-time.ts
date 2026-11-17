import type { ShareLegTime } from 'src/domain/share/build-trip-share';
import { estimateLeg, SAME_POINT_M } from 'src/domain/trips/geo';
import type { Leg } from 'src/domain/trips/query';
import { isAbroadLeg } from 'src/lib/korea';

/** 경로 조회 없이 정해지는 구간 시간. 국내 자동차·도보만 null을 돌려준다. */
export function fixedLegTime(leg: Leg): ShareLegTime | null {
  const plain = { tollFare: null, queriedAt: null, path: [] };
  if (!(leg.straightM >= SAME_POINT_M)) {
    return { ...plain, status: 'same-point', durationS: 0, distanceM: 0 };
  }
  const estimate = estimateLeg(leg.mode, leg.straightM);
  if (leg.minutes !== null) {
    return {
      ...plain,
      status: 'manual',
      distanceM: estimate.distanceM,
      durationS: leg.minutes * 60,
    };
  }
  if (isAbroadLeg(leg.from, leg.to)) {
    return { ...plain, status: 'estimated', distanceM: Math.round(leg.straightM), durationS: 0 };
  }
  if (leg.mode === 'transit') {
    return { ...plain, status: 'estimated', ...estimate };
  }
  return null;
}
