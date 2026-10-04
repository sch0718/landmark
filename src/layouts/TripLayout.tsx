import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import useMediaQuery from '@mui/material/useMediaQuery';
import { atom, useAtomValue } from 'jotai';
import { useContext, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { TripStoreContext } from 'src/stores/trip-store';

type Props = { topBar: ReactNode; map: ReactNode; panel: ReactNode };

export const PANEL_WIDTH = 400;
const NEVER_UNAVAILABLE = atom<string | null>(null);

/** 데스크톱은 오른쪽 접이식 패널, 모바일(< 768px)은 하단 시트(§4.2). */
export function TripLayout({ topBar, map, panel }: Props) {
  const mobile = useMediaQuery('(max-width: 767px)');
  const ts = useContext(TripStoreContext);
  const unavailable = useAtomValue(ts?.mapUnavailableAtom ?? NEVER_UNAVAILABLE);
  if (unavailable) {
    // 목록 전용 모드(§6): 지도 영역을 렌더하지 않고 패널을 전체 폭(모바일은 시트 full)으로 보여 준다.
    return (
      <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {topBar}
        <Alert severity="warning" role="alert" sx={{ borderRadius: 0 }}>
          {unavailable}
        </Alert>
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }} data-testid="trip-list-only">
          {panel}
        </Box>
      </Box>
    );
  }
  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {topBar}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex' }}>
        <Box sx={{ flex: 1, minWidth: 0, position: 'relative' }} data-testid="trip-map-area">
          {map}
        </Box>
        {mobile ? <BottomSheet>{panel}</BottomSheet> : <SidePanel>{panel}</SidePanel>}
      </Box>
    </Box>
  );
}

function SidePanel({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <Box sx={{ position: 'relative', display: 'flex' }}>
      <IconButton
        size="small"
        aria-label={open ? '패널 접기' : '패널 펼치기'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        sx={{
          position: 'absolute',
          left: -36,
          top: 8,
          zIndex: 2,
          bgcolor: 'background.paper',
          boxShadow: 1,
          '&:hover': { bgcolor: 'background.paper' },
        }}
      >
        {open ? '›' : '‹'}
      </IconButton>
      <Paper
        square
        elevation={2}
        sx={{
          width: open ? PANEL_WIDTH : 0,
          overflow: 'hidden auto',
          transition: 'width 0.2s',
          height: '100%',
        }}
        aria-hidden={!open}
      >
        {open && children}
      </Paper>
    </Box>
  );
}

export type SheetSnap = 'peek' | 'half' | 'full';
const SNAPS: SheetSnap[] = ['peek', 'half', 'full'];
const SNAP_HEIGHT: Record<SheetSnap, string> = { peek: '88px', half: '50%', full: '92%' };
const DRAG_THRESHOLD = 40;

function BottomSheet({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<SheetSnap>('peek');
  const startY = useRef<number | null>(null);

  const step = (delta: number) =>
    setSnap((s) => SNAPS[Math.min(SNAPS.length - 1, Math.max(0, SNAPS.indexOf(s) + delta))]!);

  const onPointerDown = (e: PointerEvent) => {
    startY.current = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerUp = (e: PointerEvent) => {
    const from = startY.current;
    startY.current = null;
    if (from === null) return;
    const dy = e.clientY - from;
    if (dy <= -DRAG_THRESHOLD) step(1);
    else if (dy >= DRAG_THRESHOLD) step(-1);
    else setSnap((s) => (s === 'full' ? 'peek' : SNAPS[SNAPS.indexOf(s) + 1]!));
  };

  return (
    <Paper
      elevation={8}
      data-snap={snap}
      sx={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: SNAP_HEIGHT[snap],
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        transition: 'height 0.2s',
        zIndex: 2,
      }}
    >
      <Box
        role="button"
        tabIndex={0}
        aria-label="시트 크기 조절"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') step(1);
          if (e.key === 'ArrowDown') step(-1);
        }}
        sx={{
          py: 1,
          display: 'flex',
          justifyContent: 'center',
          cursor: 'grab',
          touchAction: 'none',
        }}
      >
        <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'divider' }} />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{children}</Box>
    </Paper>
  );
}
