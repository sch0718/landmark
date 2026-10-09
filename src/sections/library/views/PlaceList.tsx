import Box from '@mui/material/Box';
import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { livePlaces } from 'src/domain/library/query';
import { regionsByPlace } from 'src/domain/library/region';
import type { Label, Place } from 'src/schema/library';
import { PlaceCard } from 'src/sections/library/PlaceCard';
import { PlaceRow } from 'src/sections/library/PlaceRow';
import { placeLabels } from 'src/sections/library/place-labels';
import { VirtualRows } from 'src/sections/library/views/VirtualRows';
import { libraryAtom } from 'src/stores/library-state';
import { focusPlaceAtom } from 'src/stores/library-ui';

export type PlaceListProps = {
  places: Place[];
  /** 살아 있는 라벨. */
  labelsById: ReadonlyMap<string, Label>;
  selection: ReadonlySet<string>;
  /** 스크롤되는 조상. 가상화에 쓴다. */
  scrollElement: HTMLElement | null;
  onOpen(id: string): void;
  onToggle(id: string): void;
};

/** 목록(한 줄 행)과 카드 보기가 함께 쓰는 장소 목록. */
export function PlaceList({
  variant,
  places,
  labelsById,
  selection,
  scrollElement,
  onOpen,
  onToggle,
}: PlaceListProps & { variant: 'row' | 'card' }) {
  // 지역은 보관함 전체 기준으로 한 번만 구한다(주소가 없는 장소는 가까운 장소의 지역을 빌린다).
  const library = useAtomValue(libraryAtom);
  const regions = useMemo(() => regionsByPlace(livePlaces(library)), [library]);
  const selecting = selection.size > 0;
  const card = variant === 'card';
  // 지도에서 마커를 누르면 그 장소의 행으로 스크롤한다.
  const focus = useAtomValue(focusPlaceAtom);
  const scrollTo =
    focus === null
      ? null
      : { index: places.findIndex((place) => place.id === focus.id), seq: focus.seq };
  const list = (
    <VirtualRows
      count={places.length}
      estimate={card ? 150 : 57}
      gap={card ? 12 : 0}
      label="장소 목록"
      scrollElement={scrollElement}
      scrollTo={scrollTo}
      getKey={(index) => places[index]!.id}
      renderItem={(index) => {
        const place = places[index]!;
        const props = {
          place,
          region: regions.get(place.id) ?? '기타',
          labels: placeLabels(place, labelsById),
          selecting,
          selected: selection.has(place.id),
          onOpen,
          onToggle,
        };
        return card ? <PlaceCard {...props} /> : <PlaceRow {...props} />;
      }}
    />
  );
  return card ? <Box sx={{ p: 2 }}>{list}</Box> : list;
}
