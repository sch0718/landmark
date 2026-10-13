import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import { useAtomValue, useSetAtom } from 'jotai';
import { useState, type ReactNode } from 'react';
import { matchPath, Outlet, useLocation, useNavigate } from 'react-router';
import { ChevronLeftIcon, XIcon } from 'src/components/icons';
import { paths } from 'src/routes/paths';
import { AddPlaceHost, useAddFlowRoute } from 'src/sections/add-place/AddPlaceHost';
import { ShareDropOverlay } from 'src/sections/share-import/ShareDropOverlay';
import { useImportEntry } from 'src/sections/share-import/use-import-entry';
import { AddSheet } from 'src/sections/shell/AddSheet';
import { BottomTabs } from 'src/sections/shell/BottomTabs';
import { NavRail } from 'src/sections/shell/NavRail';
import { DETAIL_WIDTH, LIST_WIDTH } from 'src/sections/shell/pane-widths';
import { DetailSlot, ListSlot, MapSlot } from 'src/sections/shell/ShellSlots';
import { StorageBanner } from 'src/sections/shell/StorageBanner';
import { useLayout } from 'src/sections/shell/use-layout';
import {
  addFlowAtom,
  addSheetOpenAtom,
  closeAddSheetAtom,
  openAddSheetAtom,
  showsAddPanel,
} from 'src/stores/add-place';

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

type DetailMode = 'column' | 'overlay' | 'sheet';

/**
 * 상세 슬롯 하나. 폭에 따라 모양만 바뀌고 트리 위치는 그대로라서(`column` ↔ `overlay`) 창 폭이
 * 1280px을 오가도 안쪽 상세가 다시 만들어지지 않는다.
 * - `column`: 넓은 화면의 오른쪽 칸(항상 있고, 고른 장소가 없으면 안내만 보인다).
 * - `overlay`: 중간 폭에서 지도 오른쪽을 덮는 360px 패널.
 * - `sheet`: 좁은 화면의 전체 화면 시트.
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
  const floating = mode !== 'column';
  const sheet = mode === 'sheet';
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
        ...(floating
          ? {
              position: sheet ? 'fixed' : 'absolute',
              zIndex: 1100,
              top: 0,
              right: 0,
              bottom: 0,
              ...(sheet
                ? { left: 0, pt: 'env(safe-area-inset-top, 0px)' }
                : { width: DETAIL_WIDTH, maxWidth: '100%' }),
              borderLeft: sheet ? 0 : '1px solid var(--tm-border)',
              boxShadow: sheet ? 'none' : 'var(--tm-shadow-2)',
            }
          : {
              flex: 'none',
              width: DETAIL_WIDTH,
              borderLeft: '1px solid var(--tm-border)',
            }),
      }}
    >
      {floating && (
        <Box sx={{ flex: 'none', display: 'flex', p: 0.5 }}>
          <IconButton onClick={onClose} aria-label={sheet ? '목록으로' : '닫기'}>
            {sheet ? <ChevronLeftIcon aria-hidden="true" /> : <XIcon aria-hidden="true" />}
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
 * 앱 뼈대(스펙 §4.1). 폭에 따라 레일·목록·지도·상세를 배치하고 하단 탭을 붙인다.
 * `/`·`/map`·`/place/:id`는 같은 셸이 목록·지도·상세 슬롯을 채우고, 그 밖의 경로(`/labels`·`/settings`·
 * `/trips`)는 자식 라우트(`Outlet`)가 본문을 채운다.
 */
export function AppShell() {
  const layout = useLayout();
  const location = useLocation();
  const { pathname } = location;
  const navigate = useNavigate();
  // ＋추가 시트. 계획 화면도 여행 대상을 붙여 열 수 있도록 atom에 둔다. 레일·탭의 ＋는 대상 없이 연다.
  const addOpen = useAtomValue(addSheetOpenAtom);
  const openAdd = useSetAtom(openAddSheetAtom);
  const closeAdd = useSetAtom(closeAddSheetAtom);
  // 추가 흐름의 칸은 상세 칸 자리를 쓴다(상세가 열려 있어도 추가 흐름이 우선).
  const flow = useAtomValue(addFlowAtom);
  const adding = showsAddPanel(flow);
  // 핀 모드는 지도 전체를 쓴다. 중간 폭에서 지도를 덮는 상세 오버레이를 그동안 내린다.
  const pinning = flow.step === 'pin';

  // 끝의 `/`가 있어도(`/map/`) 같은 경로로 본다.
  const placeId = matchPath(paths.place(':id'), pathname)?.params.id ?? null;
  const isMap = matchPath(paths.map, pathname) !== null;
  const isLibraryView = isMap || placeId !== null || matchPath(paths.library, pathname) !== null;

  // 좁은 화면에서 장소 시트 뒤에 깔리는 화면(목록/지도). 마지막으로 본 쪽을 기억한다.
  const [origin, setOrigin] = useState<'list' | 'map'>('list');
  const viewOrigin = isMap ? 'map' : 'list';
  if (placeId === null && isLibraryView && origin !== viewOrigin) setOrigin(viewOrigin); // 렌더 중 상태 갱신
  const sheetOnMap = placeId !== null && origin === 'map';
  // 좁은 화면은 지도 탭에서만 지도가 가리지 않고 보인다(장소 시트는 지도를 덮는다).
  useAddFlowRoute(layout === 'compact' ? isMap : isLibraryView);
  // `/import`로 들어오면 주소를 `/`로 바꾸고 공유 파일 가져오기 흐름을 연다.
  useImportEntry();

  const closeDetail = () => {
    // 좁은 화면은 시트를 연 기록을 되감아 모바일 뒤로가기와 어긋나지 않게 한다. 앱 안에서 연
    // 기록이 없으면(링크로 바로 들어옴) 앱을 벗어나지 않도록 기록을 교체한다.
    if (layout === 'compact') {
      if (location.key !== 'default') void navigate(-1);
      else void navigate(origin === 'map' ? paths.map : paths.library, { replace: true });
      return;
    }
    void navigate(paths.library);
  };

  let body: ReactNode;
  if (!isLibraryView) {
    body = (
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        <Box component="main" sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}>
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
              onClose={closeDetail}
            />
          )
        )}
      </Box>
    );
  } else {
    body = (
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {isMap || sheetOnMap ? (
          <Pane label="지도" sx={MAP_PANE_SX}>
            <MapSlot />
          </Pane>
        ) : (
          <Pane label="장소 목록" sx={{ flex: 1 }}>
            <ListSlot />
          </Pane>
        )}
        {placeId !== null && <DetailPane mode="sheet" placeId={placeId} onClose={closeDetail} />}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        height: '100dvh',
        display: 'flex',
        bgcolor: 'var(--tm-bg-base)',
        color: 'var(--tm-text-primary)',
      }}
    >
      {layout !== 'compact' && <NavRail onAdd={() => openAdd(null)} />}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <StorageBanner />
        {body}
        {layout === 'compact' && <BottomTabs onAdd={() => openAdd(null)} />}
      </Box>
      <AddSheet open={addOpen} onClose={closeAdd} />
      {layout === 'compact' && <AddPlaceHost />}
      <ShareDropOverlay />
    </Box>
  );
}
