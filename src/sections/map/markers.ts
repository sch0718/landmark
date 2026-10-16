import type { MapMarker } from 'src/components/map/MapAdapter';
import { isVisited } from 'src/domain/library/visit';
import type { Label, Place } from 'src/schema/library';
import type { Tokens } from 'src/theme/tokens';

/** 라벨 색 하나의 팔레트(바탕 `fill`·글자 `text`·테두리 `marker`). */
export type LabelPalette = Tokens['label'][keyof Tokens['label']];

/**
 * 장소 하나의 지도 마커. 마커에는 장소 이름을 쓴다.
 * 색은 대표 라벨의 팔레트이고, 없으면 표면 바탕·기본 글자·기본 테두리다.
 * 선택된 마커는 강조색 테두리로 그리고 클러스터에 넣지 않는다.
 * React·Effect 없이 타입만 import하므로 공유 지도 페이지(`src/share-map`)도 그대로 쓴다.
 */
export function placeMarker(
  place: { id: string; lng: number; lat: number; name: string; visited?: boolean },
  palette: LabelPalette | undefined,
  tokens: Tokens,
  selected: boolean,
): MapMarker {
  return {
    id: place.id,
    lng: place.lng,
    lat: place.lat,
    label: place.name,
    color: palette?.fill ?? tokens.bg.surface,
    textColor: palette?.text ?? tokens.text.primary,
    borderColor: selected ? tokens.accent.main : (palette?.marker ?? tokens.border),
    selected,
    ...(place.visited === true ? { visited: true } : {}),
    // 선택된 장소는 이웃에 묶이지 않고 항상 이름으로 보인다.
    clusterable: !selected,
  };
}

/** 장소를 지도 마커로 바꾼다. 색은 첫 번째 살아 있는 라벨의 팔레트다(`placeMarker`). */
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
    const palette = first === undefined ? undefined : tokens.label[first.color.value];
    return placeMarker(
      {
        id: place.id,
        lng: place.lng,
        lat: place.lat,
        name: place.name.value,
        visited: isVisited(place),
      },
      palette,
      tokens,
      place.id === selectedId,
    );
  });
}
