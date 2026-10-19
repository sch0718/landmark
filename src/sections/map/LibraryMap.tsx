import Box from '@mui/material/Box';
import { visuallyHidden } from '@mui/utils';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { MapPadding } from 'src/components/map/MapAdapter';
import { MapView } from 'src/components/map/MapView';
import { MyLocationButton } from 'src/components/map/MyLocationButton';
import {
  hasVisited,
  labelCounts,
  liveLabels,
  queryPlaces,
  visitCounts,
} from 'src/domain/library/query';
import { radiusBox } from 'src/domain/nearby';
import { useOpenPlace } from 'src/sections/library/use-open-place';
import { PinModeOverlay } from 'src/sections/add-place/PinModeOverlay';
import { useOpenPlaceId } from 'src/sections/library/use-open-place-id';
import { LabelChips } from 'src/sections/library/LabelChips';
import { VisitChips } from 'src/sections/library/VisitChips';
import { useLibraryQuery } from 'src/sections/library/use-library-query';
import { placeMarker, toMarkers } from 'src/sections/map/markers';
import { NearbyMapChip } from 'src/sections/nearby/NearbyMapChip';
import { useNearby } from 'src/sections/nearby/use-nearby';
import { DETAIL_WIDTH } from 'src/sections/shell/pane-widths';
import { useSheetHalfPx } from 'src/sections/shell/sheet-snap';
import { useCloseDetail } from 'src/sections/shell/use-close-detail';
import { useLayout } from 'src/sections/shell/use-layout';
import { addFlowAtom, showsAddPanel } from 'src/stores/add-place';
import { libraryAtom } from 'src/stores/library-state';
import { focusPlaceAtom } from 'src/stores/library-ui';
import { locateAtom, myLocationAtom, nearbyAtom } from 'src/stores/my-location';
import { useThemeTokens } from 'src/theme/use-theme';

const EDGE = 40;
const BASE_PADDING: MapPadding = { top: EDGE, right: EDGE, bottom: EDGE, left: EDGE };
/** 중간 폭에서 상세가 지도 오른쪽을 덮을 때, 가려지지 않는 쪽으로 맞춘다. */
const OVERLAID_PADDING: MapPadding = { ...BASE_PADDING, right: DETAIL_WIDTH + EDGE };

type MapFocus = { point: [number, number]; seq: number };

/** 확인 카드의 후보·핀 입력 카드의 위치를 보이는 임시 마커 id. 장소 id(10자 영숫자)와 겹치지 않는다. */
const CANDIDATE_MARKER_ID = 'candidate';

/** `내 위치 보기`가 위치를 지도에 그렸을 때 눈에 안 보이는 알림(스펙 §4.3). */
const LOCATED_MESSAGE = '내 위치를 지도에 표시했어요';

/**
 * 보관함 지도(스펙 §4.5). 목록과 같은 필터(`useLibraryQuery`)로 거른 장소를 라벨 색 마커로 보여 준다.
 * - 마커를 누르면 그 장소의 상세로 가고, 목록은 그 행으로 스크롤한다(`focusPlaceAtom`). 고른 마커를 다시
 *   누르거나 지도 빈 곳을 누르면 선택을 푼다.
 * - 거르기가 바뀌면 지도를 결과 전체에 맞추고, 열린 장소가 결과 밖이면 선택을 푼다(스펙 A1 §4).
 * - 목록·상세에서 장소를 고르면(경로의 `/place/:id`) 지도가 그 장소로 움직인다. 방금 지도에서 누른 장소는
 *   상세 오버레이가 새로 생기는 경우에만 옮긴다.
 * - 좁은 화면(`/map`)에서는 위에 근처·방문·라벨 필터 칩 한 줄을 둔다.
 * - 오른쪽 위 `내 위치 보기`로 내 위치 점을 그리고 그리로 옮긴다. 근처 모드면 목록처럼 반경 안 장소만 보이고
 *   지도를 반경 상자에 맞춘다(스펙 §4.3).
 * - 링크로 찾은 후보의 확인 카드가 열려 있으면 그 좌표로 옮기고 임시 마커를 보인다(스펙 §2.2).
 * - 핀 모드면 가운데 조준점 오버레이를 덮고 지도 중심을 넘긴다. 시작 좌표가 있으면 그리로 옮기고, 마커를
 *   눌러도 상세로 가지 않는다. 핀 입력 카드가 열리면 고른 위치에 임시 마커를 둔다(스펙 §2.4).
 */
export function LibraryMap() {
  const library = useAtomValue(libraryAtom);
  const [query, patch] = useLibraryQuery();
  const tokens = useThemeTokens();
  const layout = useLayout();
  const openPlace = useOpenPlace();
  const closeDetail = useCloseDetail();
  const requestListScroll = useSetAtom(focusPlaceAtom);
  const placeId = useOpenPlaceId();
  const flow = useAtomValue(addFlowAtom);
  const candidate = flow.step === 'candidate' ? flow.candidate : null;
  const pinning = flow.step === 'pin';
  // `start`는 스펙 §2.4.4용으로 남겨 둔 값이다. 아직 채우는 호출이 없어 지금은 항상 null이다.
  const pinStart = flow.step === 'pin' ? flow.start : null;
  // 임시 마커 자리: 확인 카드의 후보나 핀 입력 카드의 위치.
  const tempPoint = useMemo(() => {
    if (flow.step === 'candidate') return flow.candidate;
    if (flow.step === 'pin-card') return { lng: flow.lng, lat: flow.lat, name: flow.name };
    return null;
  }, [flow]);
  // 중간 폭에서는 상세 칸이나 추가 칸이 지도 오른쪽을 덮는다. 핀 모드에는 셸이 상세를 내려 지도 전체를 쓴다.
  const detailOverlaid =
    layout === 'medium' && !pinning && (placeId !== null || showsAddPanel(flow));
  // 휴대폰에서는 상세 시트가 지도 아래쪽을 덮는다(이 지도가 그려져 있으면 시트 뒤가 지도다). 다 펼치면 지도가
  // 통째로 가려지므로 여백은 늘 반쯤 높이로 둔다.
  const sheetOverlaid = layout === 'compact' && !pinning && placeId !== null;
  const sheetHalf = useSheetHalfPx();
  // 지금 지도 중심(핀 모드의 조준점 자리). 지도가 영역 변경을 알릴 때마다 갱신된다.
  const [center, setCenter] = useState<[number, number] | null>(null);

  const clusterStyle = useMemo(
    () => ({ color: tokens.accent.main, textColor: tokens.accent.contrast }),
    [tokens],
  );

  // 마커는 순서가 의미 없으므로 `다녀온 날순`을 따로 적용하지 않는다. 근처 모드면 목록과 같이 반경 안만 남긴다.
  const filtered = useMemo(() => queryPlaces(library, query), [library, query]);
  const nearby = useNearby(filtered);
  const places = nearby.places;
  const { fix, locating } = useAtomValue(myLocationAtom);
  const markers = useMemo(() => {
    const shown = toMarkers(places, library.labels, tokens, placeId);
    // 필터에 가려진 장소를 열어 두었다면 그 장소만은 개별 마커로 항상 보인다.
    const open = placeId === null ? undefined : library.places[placeId];
    if (open === undefined || open.deletedAt !== null || places.some((p) => p.id === open.id)) {
      return shown;
    }
    const [hidden] = toMarkers([open], library.labels, tokens, placeId);
    // 맞추기에서는 뺀다: 지도는 거르기 결과에 맞춘다(스펙 A1 §4). 마커는 보인다.
    return [...shown, { ...hidden!, fit: false as const }];
  }, [places, library.places, library.labels, tokens, placeId]);

  // 임시 마커: 선택된 장소처럼 강조색 테두리로 그리고 클러스터에 넣지 않는다.
  const shownMarkers = useMemo(
    () =>
      tempPoint === null
        ? markers
        : [
            ...markers,
            placeMarker(
              {
                id: CANDIDATE_MARKER_ID,
                lng: tempPoint.lng,
                lat: tempPoint.lat,
                name: tempPoint.name,
              },
              undefined,
              tokens,
              true,
            ),
          ],
    [markers, tempPoint, tokens],
  );

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

  // 필터가 바뀌면 지도는 새 필터에 맞춰지거나 그 필터의 옛 카메라로 돌아간다. 근처 모드는 켜지거나 반경·위치가
  // 바뀔 때마다, 그리고 근처 모드에서 `내 위치 보기`를 누를 때마다 `nearbySeq`를 올려 늘 새 키로 다시 맞춘다.
  // 같은 반경으로 돌아오거나 껐다 켜도 옛 카메라를 되살리지 않고, 브라우저가 캐시한 위치(`maximumAge`)가 처음
  // 시각 그대로 와도 누른 것이 보인다.
  const activeFix = nearby.active ? fix : null;
  const nearbySig = activeFix === null ? null : `${nearby.radiusM ?? 'all'}:${activeFix.at}`;
  const [seenNearbySig, setSeenNearbySig] = useState(nearbySig);
  const [nearbySeq, setNearbySeq] = useState(0);
  if (seenNearbySig !== nearbySig) {
    setSeenNearbySig(nearbySig);
    setNearbySeq((prev) => prev + 1);
  }
  const nearbyKey = nearbySig === null ? null : `${nearbySig}:${nearbySeq}`;
  const fitKey = JSON.stringify([query, nearbyKey]);
  // 근처 모드면 마커 대신 이 점들로만 맞춘다(`fitMarkers={false}`): 반경이 있으면 반경 원을 감싸는 상자, 전체면
  // 반경 안 장소와 내 위치. 필터에 가려졌지만 열어 둔 장소는 넣지 않는다(스펙 §4.3은 반경 상자를 약속한다. 먼
  // 장소를 넣으면 반경을 바꿔도 지도가 그대로처럼 보인다). 그 장소의 마커는 그대로 보인다.
  const extraFitPoints = useMemo((): [number, number][] | undefined => {
    if (activeFix === null) return undefined;
    const origin: [number, number] = [activeFix.lng, activeFix.lat];
    if (nearby.radiusM !== null) return radiusBox(origin, nearby.radiusM);
    return [...places.map((p): [number, number] => [p.lng, p.lat]), origin];
  }, [activeFix, nearby.radiusM, places]);
  // 거르기(`query`)가 바뀌면 지도는 `fitKey`로 결과 전체에 맞춘다(스펙 A1 §4). 열린 장소가 새 결과에서 빠지면
  // 선택을 푼다(기록은 교체). 결과 안이면 선택·강조는 그대로 두고 그 장소로 확대하지 않는다. 근처 쪽 변화
  // (켜기·반경·새 위치)는 `query`가 아니라 풀지 않는다(기존 규칙: 열린 장소는 반경 밖이어도 보인다).
  const queryKey = JSON.stringify(query);
  const seenQueryKey = useRef(queryKey);
  useEffect(() => {
    if (seenQueryKey.current === queryKey) return;
    seenQueryKey.current = queryKey;
    if (placeId !== null && !places.some((p) => p.id === placeId)) closeDetail({ replace: true });
  }, [queryKey, placeId, places, closeDetail]);

  // 상세 덮개(중간 폭 오버레이·휴대폰 시트)가 새로 지도를 덮으면(넓은 화면에서 줄이거나 마커를 눌러 열 때) 열어 둔
  // 장소를 가려지지 않는 쪽으로 다시 모은다. 임시 마커가 있으면(핀 모드에서 입력 카드로 넘어갈 때) 그 위치를 모은다.
  // 덮개가 사라질 때는 장소가 계속 보이므로 지도를 그대로 둔다.
  const covered = detailOverlaid || sheetOverlaid;
  const [seenOverlay, setSeenOverlay] = useState(covered);
  if (seenOverlay !== covered) {
    setSeenOverlay(covered);
    const open = !covered || placeId === null ? undefined : library.places[placeId];
    if (covered && tempPoint !== null) {
      setFocus({ point: [tempPoint.lng, tempPoint.lat], seq: (focus?.seq ?? 0) + 1 });
    } else if (open !== undefined && open.deletedAt === null) {
      setFocus({ point: [open.lng, open.lat], seq: (focus?.seq ?? 0) + 1 });
    }
  }

  // 후보가 새로 열리면 그 좌표로 옮긴다(렌더 중 상태 갱신).
  const [seenCandidate, setSeenCandidate] = useState<typeof candidate>(null);
  if (seenCandidate !== candidate) {
    setSeenCandidate(candidate);
    if (candidate !== null) {
      setFocus({ point: [candidate.lng, candidate.lat], seq: (focus?.seq ?? 0) + 1 });
    }
  }

  // 핀 모드가 시작 좌표와 함께 열리면 그리로 옮긴다(렌더 중 상태 갱신).
  const [seenStart, setSeenStart] = useState<typeof pinStart>(null);
  if (seenStart !== pinStart) {
    setSeenStart(pinStart);
    if (pinStart !== null) setFocus({ point: pinStart, seq: (focus?.seq ?? 0) + 1 });
  }

  const [unavailable, setUnavailable] = useState<string | null>(null);

  // `내 위치 보기`: 한 번 찾고, 근처 모드가 아니면 그리로 옮긴다(근처 모드면 반경 상자에 다시 맞춘다).
  const locate = useSetAtom(locateAtom);
  const store = useStore();
  const [announcement, setAnnouncement] = useState('');
  const onLocate = useCallback(async () => {
    // 같은 문장을 다시 읽히도록 먼저 비운다.
    setAnnouncement('');
    const result = await locate();
    if (result.kind === 'error') {
      toast.error(result.error.userMessage);
      return;
    }
    const { lng, lat } = result.fix;
    if (store.get(nearbyAtom).on) {
      setNearbySeq((prev) => prev + 1);
    } else {
      setFocus((prev) => ({ point: [lng, lat], seq: (prev?.seq ?? 0) + 1 }));
    }
    setAnnouncement(LOCATED_MESSAGE);
  }, [locate, store]);

  // 추가 칸이 열려 있는 동안은 마커 다시 누르기·빈 곳 누르기로 선택을 풀지 않는다(스펙 A1 §3.2).
  const adding = showsAddPanel(flow);
  const onMarkerClick = useCallback(
    (id: string) => {
      if (id === CANDIDATE_MARKER_ID) return; // 아직 보관함에 없는 후보다.
      if (pinning) return; // 핀 모드에서는 위치만 고른다.
      // 고른 마커를 다시 누르면 선택을 푼다(스펙 A1 §3.2). 추가 칸이 열려 있으면 그대로 둔다.
      if (id === placeId) {
        if (!adding) closeDetail();
        return;
      }
      setFromMarker(id);
      requestListScroll((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }));
      openPlace(id, 'map');
    },
    [openPlace, requestListScroll, pinning, adding, placeId, closeDetail],
  );

  // 지도 빈 곳을 누르면 선택을 푼다. 핀 모드(조준점 조작)와 추가 칸이 열려 있을 때는 그쪽 몫이다.
  const onMapClick = useCallback(() => {
    if (pinning || adding || placeId === null) return;
    closeDetail();
  }, [pinning, adding, placeId, closeDetail]);

  const labels = useMemo(() => liveLabels(library), [library]);
  const counts = useMemo(() => labelCounts(library, query), [library, query]);
  const visits = useMemo(() => visitCounts(library, query), [library, query]);
  const showVisit = useMemo(
    () => hasVisited(library) || query.visited !== 'all',
    [library, query.visited],
  );
  const padding = useMemo(
    () =>
      detailOverlaid
        ? OVERLAID_PADDING
        : sheetOverlaid
          ? { ...BASE_PADDING, bottom: sheetHalf + EDGE }
          : BASE_PADDING,
    [detailOverlaid, sheetOverlaid, sheetHalf],
  );

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {layout === 'compact' && (
        <Box sx={{ flex: 'none', py: 0.5, bgcolor: 'var(--tm-bg-surface)' }}>
          <LabelChips
            query={query}
            onChange={patch}
            labels={labels}
            counts={counts}
            background="var(--tm-bg-surface)"
            leading={
              nearby.active || showVisit ? (
                <>
                  <NearbyMapChip />
                  {showVisit && (
                    <VisitChips
                      value={query.visited}
                      counts={visits}
                      onChange={(visited) => patch({ visited })}
                    />
                  )}
                </>
              ) : undefined
            }
          />
        </Box>
      )}
      <Box sx={{ position: 'relative', flex: 1, minHeight: 0, bgcolor: 'var(--tm-bg-raised)' }}>
        <MapView
          markers={shownMarkers}
          polylines={[]}
          clusterStyle={clusterStyle}
          padding={padding}
          onMarkerClick={onMarkerClick}
          onMapClick={onMapClick}
          focus={focus}
          fitKey={fitKey}
          onUnavailable={setUnavailable}
          onCenterChange={setCenter}
          myLocation={fix}
          controls={<MyLocationButton locating={locating} onClick={() => void onLocate()} />}
          controlsRight={detailOverlaid ? DETAIL_WIDTH : 0}
          extraFitPoints={extraFitPoints}
          fitMarkers={activeFix === null}
        />
        {unavailable === null && (
          <Box role="status" sx={visuallyHidden}>
            {announcement}
          </Box>
        )}
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
        {pinning && <PinModeOverlay center={unavailable === null ? center : null} />}
      </Box>
    </Box>
  );
}
