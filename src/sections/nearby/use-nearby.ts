import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useMemo } from 'react';
import { nearbyPlaces, type NearbyRadius } from 'src/domain/nearby';
import type { Place } from 'src/schema/library';
import { locateAtom, myLocationAtom, nearbyAtom } from 'src/stores/my-location';
import { visitedSortAtom } from 'src/stores/visit-sort';

export type NearbyView = {
  /** 근처 모드이고 내 위치가 있다. 이때만 `places`가 거리순·반경 안이다. */
  active: boolean;
  places: Place[];
  /** 장소 id → 직선거리(m). 근처가 아니면 null. */
  distances: ReadonlyMap<string, number> | null;
  radiusM: NearbyRadius;
};

/**
 * 필터 결과(`filtered`)에 근처 모드를 씌운다(스펙 §7.3). 근처 모드이고 위치가 있으면 반경 안만 가까운 순으로,
 * 아니면(꺼짐·첫 요청 중·첫 요청 실패) 받은 목록을 그대로 돌려준다. `다시 찾기` 중에는 이전 위치로 계속 보인다.
 */
export function useNearby(filtered: Place[]): NearbyView {
  const { on, radiusM } = useAtomValue(nearbyAtom);
  const { fix } = useAtomValue(myLocationAtom);
  return useMemo(() => {
    if (!on || fix === null) return { active: false, places: filtered, distances: null, radiusM };
    const result = nearbyPlaces(filtered, [fix.lng, fix.lat], radiusM);
    return { active: true, places: result.places, distances: result.distances, radiusM };
  }, [on, fix, radiusM, filtered]);
}

/**
 * `가까운 순`을 켠다. 메모리 정렬은 하나만 켜지므로 `다녀온 날순`을 끄고, 위치를 한 번 묻는다.
 * 결과는 돌려받지 않고 `myLocationAtom` 상태로만 본다(실패도 값으로 상태에 들어간다).
 */
export function useStartNearby(): () => void {
  const setVisitedSort = useSetAtom(visitedSortAtom);
  const setNearby = useSetAtom(nearbyAtom);
  const locate = useSetAtom(locateAtom);
  return useCallback(() => {
    setVisitedSort(false);
    setNearby((prev) => ({ ...prev, on: true }));
    void locate();
  }, [setVisitedSort, setNearby, locate]);
}
