import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import { useState, type ReactNode } from 'react';
import { matchPath, Outlet, useLocation, useNavigate } from 'react-router';
import { ChevronLeftIcon, XIcon } from 'src/components/icons';
import { paths } from 'src/routes/paths';
import { AddSheet } from 'src/sections/shell/AddSheet';
import { BottomTabs } from 'src/sections/shell/BottomTabs';
import { NavRail } from 'src/sections/shell/NavRail';
import { DetailSlot, ListSlot, MapSlot } from 'src/sections/shell/ShellSlots';
import { StorageBanner } from 'src/sections/shell/StorageBanner';
import { useLayout } from 'src/sections/shell/use-layout';

const LIST_WIDTH = 360;
const DETAIL_WIDTH = 360;

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

/** 지도 위(중간 폭) 또는 화면 전체(좁은 폭)를 덮는 상세. 닫으면 보관함으로 돌아간다. */
function DetailOverlay({
  placeId,
  fullScreen,
  onClose,
}: {
  placeId: string;
  fullScreen: boolean;
  onClose: () => void;
}) {
  return (
    <Box
      component="section"
      aria-label="장소 상세"
      sx={{
        position: fullScreen ? 'fixed' : 'absolute',
        zIndex: 1100,
        top: 0,
        right: 0,
        bottom: 0,
        ...(fullScreen ? { left: 0 } : { width: DETAIL_WIDTH, maxWidth: '100%' }),
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'var(--tm-bg-surface)',
        borderLeft: fullScreen ? 0 : '1px solid var(--tm-border)',
        boxShadow: fullScreen ? 'none' : 'var(--tm-shadow-2)',
      }}
    >
      <Box sx={{ flex: 'none', display: 'flex', p: 0.5 }}>
        <IconButton onClick={onClose} aria-label={fullScreen ? '목록으로' : '닫기'}>
          {fullScreen ? <ChevronLeftIcon aria-hidden="true" /> : <XIcon aria-hidden="true" />}
        </IconButton>
      </Box>
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
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);

  const placeId = matchPath(paths.place(':id'), pathname)?.params.id ?? null;
  const isLibraryView = pathname === paths.library || pathname === paths.map || placeId !== null;
  const closeDetail = () => void navigate(paths.library);

  let body: ReactNode;
  if (!isLibraryView) {
    body = (
      <Box component="main" sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Outlet />
      </Box>
    );
  } else if (layout === 'wide') {
    body = (
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Pane
          label="장소 목록"
          sx={{ flex: 'none', width: LIST_WIDTH, borderRight: '1px solid var(--tm-border)' }}
        >
          <ListSlot />
        </Pane>
        <Pane label="지도" sx={{ flex: 1 }}>
          <MapSlot />
        </Pane>
        <Pane
          label="장소 상세"
          sx={{ flex: 'none', width: DETAIL_WIDTH, borderLeft: '1px solid var(--tm-border)' }}
        >
          <DetailSlot placeId={placeId} />
        </Pane>
      </Box>
    );
  } else if (layout === 'medium') {
    body = (
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Pane
          label="장소 목록"
          sx={{ flex: 'none', width: LIST_WIDTH, borderRight: '1px solid var(--tm-border)' }}
        >
          <ListSlot />
        </Pane>
        <Box sx={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <Pane label="지도" sx={{ height: '100%' }}>
            <MapSlot />
          </Pane>
          {placeId !== null && (
            <DetailOverlay placeId={placeId} fullScreen={false} onClose={closeDetail} />
          )}
        </Box>
      </Box>
    );
  } else {
    body = (
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {pathname === paths.map ? (
          <Pane label="지도" sx={{ flex: 1 }}>
            <MapSlot />
          </Pane>
        ) : (
          <Pane label="장소 목록" sx={{ flex: 1 }}>
            <ListSlot />
          </Pane>
        )}
        {placeId !== null && <DetailOverlay placeId={placeId} fullScreen onClose={closeDetail} />}
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
      {layout !== 'compact' && <NavRail onAdd={() => setAddOpen(true)} />}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <StorageBanner />
        {body}
        {layout === 'compact' && <BottomTabs onAdd={() => setAddOpen(true)} />}
      </Box>
      <AddSheet open={addOpen} onClose={() => setAddOpen(false)} />
    </Box>
  );
}
