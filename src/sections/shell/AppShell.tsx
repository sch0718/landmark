import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useLayoutEffect, type ReactNode } from 'react';
import { matchPath, Outlet, useLocation, useNavigate } from 'react-router';
import { XIcon } from 'src/components/icons';
import { useDocumentTitle } from 'src/lib/use-document-title';
import { paths } from 'src/routes/paths';
import { AddPlaceHost, useAddFlowRoute } from 'src/sections/add-place/AddPlaceHost';
import { ShareDropOverlay } from 'src/sections/share-import/ShareDropOverlay';
import { useImportEntry } from 'src/sections/share-import/use-import-entry';
import { AddSheet } from 'src/sections/shell/AddSheet';
import { BackupReminder } from 'src/sections/shell/BackupReminder';
import { BottomTabs } from 'src/sections/shell/BottomTabs';
import { NavRail } from 'src/sections/shell/NavRail';
import { DETAIL_WIDTH, LIST_WIDTH } from 'src/sections/shell/pane-widths';
import { PlaceSheet } from 'src/sections/shell/PlaceSheet';
import { DetailSlot, ListSlot, MapSlot } from 'src/sections/shell/ShellSlots';
import type { SheetSnap } from 'src/sections/shell/sheet-snap';
import { sheetLocationState, sheetStateOf } from 'src/sections/shell/sheet-state';
import { MAIN_ID, SkipLink } from 'src/sections/shell/SkipLink';
import { StorageBanner } from 'src/sections/shell/StorageBanner';
import {
  useCloseDetail,
  useEscapeClose,
  useFocusReturnOnClose,
} from 'src/sections/shell/use-close-detail';
import { useLayout } from 'src/sections/shell/use-layout';
import {
  addFlowAtom,
  addSheetOpenAtom,
  closeAddSheetAtom,
  openAddSheetAtom,
  showsAddPanel,
} from 'src/stores/add-place';
import { libraryAtom } from 'src/stores/library-state';
import { detailOriginAtom } from 'src/stores/library-ui';

/** 슬롯 하나. 랜드마크(`aria-label`)와 스크롤을 맡는다. */
function Pane({
  label,
  sx,
  children,
}: {
  label: string;
  sx?: SxProps<Theme>;
  children: ReactNode;
}) {
  return (
    <Box
      component="section"
      aria-label={label}
      sx={[{ minWidth: 0, minHeight: 0, overflow: 'auto' }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {children}
    </Box>
  );
}

/** 지도 슬롯. 지도는 스스로 크기를 정하므로 가운데 칸을 꽉 채우고 넘치는 부분은 자른다. */
const MAP_PANE_SX: SxProps<Theme> = { flex: 1, height: '100%', overflow: 'hidden' };

type DetailMode = 'column' | 'overlay';

/**
 * 넓은·중간 화면의 상세 슬롯. 폭에 따라 모양만 바뀌고 트리 위치는 그대로라서(`column` ↔ `overlay`) 창 폭이
 * 1280px을 오가도 안쪽 상세가 다시 만들어지지 않는다. 휴대폰은 `PlaceSheet`를 쓴다.
 * - `column`: 넓은 화면의 오른쪽 칸(항상 있고, 고른 장소가 없으면 안내만 보인다. 열려 있으면 닫기가 있다).
 * - `overlay`: 중간 폭에서 지도 오른쪽을 덮는 360px 패널.
 */
function DetailPane({
  mode,
  placeId,
  onClose,
}: {
  mode: DetailMode;
  placeId: string | null;
  onClose: () => void;
}) {
  const overlay = mode === 'overlay';
  const closable = overlay || placeId !== null;
  return (
    <Box
      component="section"
      aria-label="장소 상세"
      sx={{
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'var(--tm-bg-surface)',
        ...(overlay
          ? {
              position: 'absolute',
              zIndex: 1100,
              top: 0,
              right: 0,
              bottom: 0,
              width: DETAIL_WIDTH,
              maxWidth: '100%',
              borderLeft: '1px solid var(--tm-border)',
              boxShadow: 'var(--tm-shadow-2)',
            }
          : {
              flex: 'none',
              width: DETAIL_WIDTH,
              borderLeft: '1px solid var(--tm-border)',
            }),
      }}
    >
      {closable && (
        <Box sx={{ flex: 'none', display: 'flex', p: 0.5 }}>
          <IconButton onClick={onClose} aria-label="닫기">
            <XIcon aria-hidden="true" />
          </IconButton>
        </Box>
      )}
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <DetailSlot placeId={placeId} />
      </Box>
    </Box>
  );
}

/**
 * 보관함·지도·장소 상세 화면의 제목. 화면 제목(`h1`)과 탭 제목을 함께 정한다. 이 화면들만 그릴 때 두어서,
 * 다른 경로의 자식 화면이 자기 탭 제목을 정하는 것을 가리지 않는다.
 * - 보관함·지도: 화면에 보이지 않는 `h1`(목록·지도 칸은 제목 없는 랜드마크라서).
 * - 장소 상세: 장소 이름이 `h1`이라(`PlaceDetail`) 여기서는 탭 제목만 정한다. 다만 추가 칸이나 핀 모드가 상세 칸을
 *   내려(`detailShown`이 거짓) `PlaceDetail`이 없을 때는 장소 이름을 눈에만 숨긴 `h1`로 대신한다.
 */
function LibraryViewTitle({
  placeId,
  isMap,
  detailShown,
}: {
  placeId: string | null;
  isMap: boolean;
  detailShown: boolean;
}) {
  const library = useAtomValue(libraryAtom);
  const place = placeId === null ? undefined : library.places[placeId];
  const screen =
    placeId !== null
      ? place?.deletedAt === null
        ? place.name.value
        : null
      : isMap
        ? '지도'
        : '보관함';
  useDocumentTitle(screen);
  if (placeId !== null && detailShown) return null;
  if (screen === null) return null;
  return (
    <Box component="h1" sx={visuallyHidden}>
      {screen}
    </Box>
  );
}

/**
 * 앱 뼈대(스펙 §4.1). 폭에 따라 레일·목록·지도·상세를 배치하고 하단 탭을 붙인다.
 * `/`·`/map`·`/place/:id`는 같은 셸이 목록·지도·상세 슬롯을 채우고, 그 밖의 경로(`/labels`·`/settings`·
 * `/trips`)는 자식 라우트(`Outlet`)가 본문을 채운다.
 */
export function AppShell() {
  const layout = useLayout();
  const location = useLocation();
  const { pathname } = location;
  const navigate = useNavigate();
  // ＋추가 시트. 계획 화면도 여행 대상을 붙여 열 수 있도록 atom에 둔다. 레일·탭의 ＋는 대상 없이 열고,
  // 흐름을 닫을 때 포커스가 돌아올 곳으로 자신을 남긴다.
  const addOpen = useAtomValue(addSheetOpenAtom);
  const openAdd = useSetAtom(openAddSheetAtom);
  const closeAdd = useSetAtom(closeAddSheetAtom);
  const openFromPlus = (opener: HTMLElement) => openAdd(null, opener);
  // 추가 흐름의 칸은 상세 칸 자리를 쓴다(상세가 열려 있어도 추가 흐름이 우선).
  const flow = useAtomValue(addFlowAtom);
  const adding = showsAddPanel(flow);
  // 핀 모드는 지도 전체를 쓴다. 중간 폭에서 지도를 덮는 상세 오버레이를 그동안 내린다.
  const pinning = flow.step === 'pin';

  // 끝의 `/`가 있어도(`/map/`) 같은 경로로 본다.
  const placeId = matchPath(paths.place(':id'), pathname)?.params.id ?? null;
  const isMap = matchPath(paths.map, pathname) !== null;
  const isLibraryView = isMap || placeId !== null || matchPath(paths.library, pathname) !== null;

  // 장소 상세(`PlaceDetail`, 장소 이름 `h1`)가 그려지는가. 넓은·중간 폭에서는 추가 칸이 상세 자리를 대신하고,
  // 중간 폭에서는 핀 모드가 상세 오버레이를 내린다(아래 `body`의 분기와 같다).
  const detailShown = layout === 'compact' || (!adding && (layout === 'wide' || !pinning));

  const [, setOrigin] = useAtom(detailOriginAtom);
  const viewOrigin = isMap ? 'map' : 'list';
  useLayoutEffect(() => {
    if (placeId === null && isLibraryView) setOrigin(viewOrigin);
  }, [placeId, isLibraryView, viewOrigin, setOrigin]);
  const sheet = placeId === null ? null : sheetStateOf(location.state);
  const sheetOnMap = sheet?.from === 'map';
  useAddFlowRoute(layout === 'compact' ? isMap : isLibraryView);
  // `/import`로 들어오면 주소를 `/`로 바꾸고 공유 파일 가져오기 흐름을 연다.
  useImportEntry();

  const closeDetail = useCloseDetail();
  useEscapeClose(isLibraryView && placeId !== null && !adding && !pinning, () => closeDetail());
  useFocusReturnOnClose(placeId);

  // 펼치기·접기: 지금 기록 항목의 상태만 바꾼다(새 항목 없음).
  const changeSnap = (snap: SheetSnap) => {
    if (sheet === null) return;
    void navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: sheetLocationState({ ...sheet, snap }) },
    );
  };

  let body: ReactNode;
  if (!isLibraryView) {
    body = (
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}>
          <Outlet />
        </Box>
        {layout !== 'compact' && <AddPlaceHost floating />}
      </Box>
    );
  } else if (layout !== 'compact') {
    // 넓은/중간 폭은 같은 트리: [목록][지도][상세]. 상세는 넓으면 오른쪽 칸, 중간이면 지도를 덮는다.
    const wide = layout === 'wide';
    body = (
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        <Pane
          label="장소 목록"
          sx={{ flex: 'none', width: LIST_WIDTH, borderRight: '1px solid var(--tm-border)' }}
        >
          <ListSlot />
        </Pane>
        <Pane label="지도" sx={MAP_PANE_SX}>
          <MapSlot />
        </Pane>
        {adding ? (
          <AddPlaceHost floating={!wide} />
        ) : (
          (wide || (placeId !== null && !pinning)) && (
            <DetailPane
              mode={wide ? 'column' : 'overlay'}
              placeId={placeId}
              onClose={() => closeDetail()}
            />
          )
        )}
      </Box>
    );
  } else {
    body = (
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          // 시트를 이 칸 안에 가두고(하단 탭은 칸 밖이라 늘 보인다), `hidden`과 달리 스크롤 컨테이너가 아니라서
          // 반쯤 시트 안에서 아래쪽으로 포커스가 가도 칸이 밀려 지도·목록이 움직이지 않는다.
          overflow: 'clip',
        }}
      >
        {isMap || sheetOnMap ? (
          <Pane label="지도" sx={MAP_PANE_SX}>
            <MapSlot />
          </Pane>
        ) : (
          <Pane label="장소 목록" sx={{ flex: 1 }}>
            <ListSlot />
          </Pane>
        )}
        {sheet !== null && (
          <PlaceSheet snap={sheet.snap} onSnapChange={changeSnap} onClose={() => closeDetail()}>
            <DetailSlot placeId={placeId} />
          </PlaceSheet>
        )}
      </Box>
    );
  }

  // 본문(`main`)은 메뉴(레일·하단 탭) 밖의 모든 것이다. 좁은 화면은 하단 탭을 본문 아래에 두려고 세로로 쌓는다.
  // 본문 바로가기와 추가 칸의 포커스 복귀가 `#main`으로 포커스를 옮긴다(`tabIndex={-1}`, 바깥선은 그리지 않는다).
  return (
    <Box
      sx={{
        height: '100dvh',
        display: 'flex',
        flexDirection: layout === 'compact' ? 'column' : 'row',
        bgcolor: 'var(--tm-bg-base)',
        color: 'var(--tm-text-primary)',
      }}
    >
      <SkipLink />
      {layout !== 'compact' && <NavRail onAdd={openFromPlus} />}
      <Box
        component="main"
        id={MAIN_ID}
        tabIndex={-1}
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          '&:focus': { outline: 'none' },
        }}
      >
        <StorageBanner />
        {isLibraryView && <BackupReminder />}
        {isLibraryView && (
          <LibraryViewTitle placeId={placeId} isMap={isMap} detailShown={detailShown} />
        )}
        {body}
      </Box>
      {layout === 'compact' && <BottomTabs onAdd={openFromPlus} />}
      <AddSheet open={addOpen} onClose={closeAdd} />
      {layout === 'compact' && <AddPlaceHost />}
      <ShareDropOverlay />
    </Box>
  );
}
