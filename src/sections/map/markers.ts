import type { MapMarker } from 'src/components/map/MapAdapter';
import type { Label, Place } from 'src/schema/library';
import type { Tokens } from 'src/theme/tokens';

/**
 * 장소를 지도 마커로 바꾼다. 색은 대표(첫 번째 살아 있는) 라벨의 마커색이고, 라벨이 없으면 흐린 글자색이다.
 * 마커는 이름 글자 없이 점으로 그린다: 어댑터가 흰 테두리와 그림자를 둘러서 밝은 지도 위에서도 보이고,
 * 노랑처럼 흰 글자와 대비가 낮은 색도 글자 없이는 문제가 되지 않는다.
 */
export function toMarkers(
  places: Place[],
  labels: Record<string, Label>,
  tokens: Tokens,
  selectedId: string | null,
): MapMarker[] {
  return places.map((place) => {
    const first = place.labelIds.value
      .map((id) => labels[id])
      .find((label): label is Label => label !== undefined && label.deletedAt === null);
    return {
      id: place.id,
      lng: place.lng,
      lat: place.lat,
      color: first === undefined ? tokens.text.muted : tokens.label[first.color.value].marker,
      selected: place.id === selectedId,
      clusterable: true,
    };
  });
}
