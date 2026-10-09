import Box from '@mui/material/Box';
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { MapPadding } from 'src/components/map/MapAdapter';
import { MapView } from 'src/components/map/MapView';
import { labelCounts, liveLabels, queryPlaces } from 'src/domain/library/query';
import { paths } from 'src/routes/paths';
import { useOpenPlaceId } from 'src/sections/library/use-open-place-id';
import { LabelChips } from 'src/sections/library/LabelChips';
import { useLibraryQuery } from 'src/sections/library/use-library-query';
import { toMarkers } from 'src/sections/map/markers';
import { DETAIL_WIDTH } from 'src/sections/shell/pane-widths';
import { useLayout } from 'src/sections/shell/use-layout';
import { libraryAtom } from 'src/stores/library-state';
import { focusPlaceAtom } from 'src/stores/library-ui';
import { useThemeTokens } from 'src/theme/use-theme';

const EDGE = 40;
const BASE_PADDING: MapPadding = { top: EDGE, right: EDGE, bottom: EDGE, left: EDGE };
/** 중간 폭에서 상세가 지도 오른쪽을 덮을 때, 가려지지 않는 쪽으로 맞춘다. */
const OVERLAID_PADDING: MapPadding = { ...BASE_PADDING, right: DETAIL_WIDTH + EDGE };

type MapFocus = { point: [number, number]; seq: number };

/**
 * 보관함 지도(스펙 §4.5). 목록과 같은 필터(`useLibraryQuery`)로 거른 장소를 라벨 색 마커로 보여 준다.
 * - 마커를 누르면 그 장소의 상세로 가고, 목록은 그 행으로 스크롤한다(`focusPlaceAtom`).
 * - 목록·상세에서 장소를 고르면(경로의 `/place/:id`) 지도가 그 장소로 움직인다. 방금 지도에서 누른 장소는
 *   이미 보이는 곳이라 움직이지 않는다.
 * - 좁은 화면(`/map`)에서는 위에 라벨 필터 칩 한 줄을 둔다.
 */
export function LibraryMap() {
  const library = useAtomValue(libraryAtom);
  const [query, patch] = useLibraryQuery();
  const tokens = useThemeTokens();
  const layout = useLayout();
  const navigate = useNavigate();
  const requestListScroll = useSetAtom(focusPlaceAtom);
  const placeId = useOpenPlaceId();

  const clusterStyle = useMemo(
    () => ({ color: tokens.accent.main, textColor: tokens.accent.contrast }),
    [tokens],
  );

  const places = useMemo(() => queryPlaces(library, query), [library, query]);
  const markers = useMemo(() => {
    const shown = toMarkers(places, library.labels, tokens, placeId);
    // 필터에 가려진 장소를 열어 두었다면 그 장소만은 개별 마커로 항상 보인다.
    const open = placeId === null ? undefined : library.places[placeId];
    if (open === undefined || open.deletedAt !== null || places.some((p) => p.id === open.id)) {
      return shown;
    }
    const [hidden] = toMarkers([open], library.labels, tokens, placeId);
    return [...shown, hidden!];
  }, [places, library.places, library.labels, tokens, placeId]);

  // 선택이 바뀌면 지도를 그 장소로 옮긴다(렌더 중 상태 갱신). `seq`를 올려 같은 장소도 다시 움직인다.
  const [seen, setSeen] = useState<string | null>(null);
  const [fromMarker, setFromMarker] = useState<string | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  if (seen !== placeId) {
    setSeen(placeId);
    setFromMarker(null);
    const place = placeId === null ? undefined : library.places[placeId];
    if (place !== undefined && place.deletedAt === null && fromMarker !== placeId) {
      setFocus({ point: [place.lng, place.lat], seq: (focus?.seq ?? 0) + 1 });
    }
  }

  // 필터가 바뀌면 지도는 새 필터에 맞춰지거나 그 필터의 옛 카메라로 돌아간다. 열어 둔 장소가 거기서 벗어나
  // 안 보이지 않도록, 맞춘 뒤에 그 장소로 다시 모은다.
  const fitKey = JSON.stringify(query);
  const [seenKey, setSeenKey] = useState(fitKey);
  if (seenKey !== fitKey) {
    setSeenKey(fitKey);
    const open = placeId === null ? undefined : library.places[placeId];
    if (open !== undefined && open.deletedAt === null) {
      setFocus({ point: [open.lng, open.lat], seq: (focus?.seq ?? 0) + 1 });
    }
  }

  const [unavailable, setUnavailable] = useState<string | null>(null);

  const onMarkerClick = useCallback(
    (id: string) => {
      setFromMarker(id);
      requestListScroll((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }));
      void navigate(paths.place(id));
    },
    [navigate, requestListScroll],
  );

  const labels = useMemo(() => liveLabels(library), [library]);
  const counts = useMemo(() => labelCounts(library, query), [library, query]);
  const padding = layout === 'medium' && placeId !== null ? OVERLAID_PADDING : BASE_PADDING;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {layout === 'compact' && (
        <Box sx={{ flex: 'none', py: 0.5, bgcolor: 'var(--tm-bg-surface)' }}>
          <LabelChips query={query} onChange={patch} labels={labels} counts={counts} />
        </Box>
      )}
      <Box sx={{ position: 'relative', flex: 1, minHeight: 0, bgcolor: 'var(--tm-bg-raised)' }}>
        <MapView
          markers={markers}
          polylines={[]}
          clusterStyle={clusterStyle}
          padding={padding}
          onMarkerClick={onMarkerClick}
          focus={focus}
          fitKey={fitKey}
          onUnavailable={setUnavailable}
        />
        {unavailable !== null && (
          <Box
            role="status"
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              p: 3,
              textAlign: 'center',
              bgcolor: 'var(--tm-bg-raised)',
              color: 'var(--tm-text-secondary)',
            }}
          >
            {unavailable}
          </Box>
        )}
      </Box>
    </Box>
  );
}
