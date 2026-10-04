import Box from '@mui/material/Box';
import { useExploreKeys } from 'src/sections/explore/store/explore-state';
import { ExploreFilters } from 'src/sections/explore/view/ExploreFilters';
import { PlaceList } from 'src/sections/explore/view/PlaceList';

/** 탐색 모드 패널: 필터 + 장소 목록(선택한 장소는 카드로 펼침). 마커는 TripPage가 `useExploreMarkers`로 넘긴다. */
export function ExplorePanel() {
  const keys = useExploreKeys();
  return (
    <Box data-testid="explore-panel">
      <ExploreFilters />
      <PlaceList keys={keys} />
    </Box>
  );
}
