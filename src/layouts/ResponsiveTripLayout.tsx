import { Alert, Backdrop, Box, Button, Typography } from '@mui/material';
import FocusTrap from '@mui/material/Unstable_TrapFocus';
import { useCallback, useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { useAtom, useStore } from 'jotai';
import { TripNavigation } from 'src/sections/views/view/TripNavigation';
import { ViewScrollContext } from 'src/sections/views/view-scroll-context';
import { useViewScroll } from 'src/sections/views/use-view-scroll';
import { mapSheetSnapAtom, viewScrollAtom } from 'src/sections/views/store/view-session';
import type { ViewMode } from 'src/stores/ui-store';
import type { MapPadding } from 'src/components/map/MapAdapter';
import { VIEW_TOKENS } from 'src/theme/view-tokens';
import { detailFocusEnabled } from './detail-focus';
import { sheetHeight, useViewportHeight, type LayoutKind, type SheetSnap } from './layout-metrics';
type Props = {
  topBar: ReactNode;
  map: ReactNode;
  panel: ReactNode;
  detail: { open: boolean; content: ReactNode; onClose(): void };
  view: ViewMode;
  layout: LayoutKind;
  unavailable: string | null;
  routeMapVisible: boolean;
  onMapPaddingChange(padding: MapPadding): void;
};
export function ResponsiveTripLayout(props: Props) {
  const viewportHeight = useViewportHeight();
  const wasOpen = useRef(false);
  const detailHostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const closed = wasOpen.current && !props.detail.open;
    wasOpen.current = props.detail.open;
    if (!closed) return;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (
        active === document.body ||
        !active?.isConnected ||
        (active !== null && detailHostRef.current?.contains(active))
      )
        document
          .querySelector<HTMLButtonElement>(
            'nav[aria-label="보기 전환"] button[aria-pressed="true"]',
          )
          ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [props.detail.open]);
  const compact = props.layout === 'compact';
  const dock = props.layout === 'wide' && props.detail.open;
  const focusEnabled = useCallback(() => !dock && detailFocusEnabled(), [dock]);
  const mapVisible =
    !props.unavailable &&
    (props.view === 'map' || (props.view === 'day' && (!compact || props.routeMapVisible)));
  const tokens = VIEW_TOKENS[props.view];
  const columns = compact
    ? 'minmax(0,1fr)'
    : props.view === 'places' || props.unavailable
      ? 'minmax(0,1fr)'
      : props.view === 'day'
        ? 'minmax(360px,440px) minmax(0,1fr)'
        : 'minmax(0,1fr) minmax(320px,400px)';
  const areas =
    props.view === 'places' || props.unavailable
      ? 'panel'
      : props.view === 'day'
        ? 'panel map'
        : 'map panel';
  return (
    <Box
      data-testid="trip-shell"
      data-layout={props.layout}
      data-view={props.view}
      sx={{
        height: viewportHeight,
        minWidth: 0,
        overflow: 'hidden',
        bgcolor: tokens.surface,
        color: tokens.ink,
        display: 'grid',
        gridTemplateColumns: compact ? 'minmax(0,1fr)' : '72px minmax(0,1fr)',
        gridTemplateRows: compact ? 'auto minmax(0,1fr) auto' : 'auto minmax(0,1fr)',
      }}
    >
      <Box sx={{ gridColumn: compact ? 1 : 2, minWidth: 0 }}>{props.topBar}</Box>
      <Box
        data-testid="trip-body"
        sx={{
          gridColumn: compact ? 1 : 2,
          minHeight: 0,
          minWidth: 0,
          position: 'relative',
          display: 'grid',
          gap: 0,
          gridTemplateColumns: dock ? `${columns} 320px` : columns,
          gridTemplateAreas: compact
            ? props.view === 'day' && mapVisible
              ? '"panel" "map"'
              : props.view === 'map' && mapVisible
                ? '"map"'
                : '"panel"'
            : `"${areas}${dock ? ' detail' : ''}"`,
          gridTemplateRows:
            compact && props.view === 'day' && mapVisible ? 'minmax(0,1fr) 180px' : 'minmax(0,1fr)',
        }}
      >
        <Box
          data-testid="trip-map-area"
          sx={{
            gridArea: compact ? undefined : 'map',
            gridRow: compact && props.view === 'day' ? 2 : 1,
            minWidth: 0,
            minHeight: 0,
            display: mapVisible ? 'block' : 'none',
            position: 'relative',
          }}
        >
          {!props.unavailable && props.map}
        </Box>
        <ViewPanel
          key={props.view}
          view={props.view}
          sheet={compact && props.view === 'map' && !props.unavailable}
          onPaddingChange={props.onMapPaddingChange}
        >
          {props.unavailable && <Alert severity="warning">{props.unavailable}</Alert>}
          {props.panel}
        </ViewPanel>
        {props.detail.open && !dock && (
          <Backdrop open onClick={props.detail.onClose} sx={{ position: 'fixed', zIndex: 4 }} />
        )}
        <FocusTrap open={props.detail.open} disableEnforceFocus={dock} isEnabled={focusEnabled}>
          <Box
            ref={detailHostRef}
            tabIndex={-1}
            aria-modal={props.detail.open && !dock ? true : undefined}
            data-detail-presentation={dock ? 'docked' : compact ? 'bottom' : 'overlay'}
            sx={{
              display: props.detail.open ? 'block' : 'none',
              minWidth: 0,
              minHeight: 0,
              gridArea: dock ? 'detail' : undefined,
              position: dock ? 'relative' : 'absolute',
              zIndex: 5,
              bgcolor: tokens.surface,
              ...(dock
                ? {}
                : compact
                  ? {
                      left: 0,
                      right: 0,
                      bottom: 0,
                      maxHeight: '88%',
                      borderRadius: '24px 24px 0 0',
                    }
                  : { right: 0, top: 0, bottom: 0, width: 360 }),
              overflow: 'auto',
            }}
          >
            {props.detail.content}
          </Box>
        </FocusTrap>
      </Box>
      <Box
        sx={{
          gridColumn: 1,
          gridRow: compact ? 3 : '1 / 3',
          borderTop: compact ? '1px solid #eceeec' : undefined,
          pb: compact ? 'env(safe-area-inset-bottom)' : 0,
        }}
      >
        <TripNavigation orientation={compact ? 'horizontal' : 'vertical'} />
      </Box>
    </Box>
  );
}

function ViewPanel({
  view,
  sheet,
  onPaddingChange,
  children,
}: {
  view: ViewMode;
  sheet: boolean;
  children: ReactNode;
  onPaddingChange(padding: MapPadding): void;
}) {
  const store = useStore();
  const [restoreScroll] = useState(() => view === 'day' && store.get(viewScrollAtom)[view] !== 0);
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const attachScroll = useCallback((element: HTMLDivElement | null) => {
    scrollRef.current = element;
    setScrollElement(element);
  }, []);
  const startY = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const [available, setAvailable] = useState(0);
  const [snap, setSnap] = useAtom(mapSheetSnapAtom);
  useViewScroll(scrollRef, view, restoreScroll);
  useEffect(() => {
    const body = hostRef.current?.parentElement;
    if (!body) return;
    let frame = 0;
    const measure = () => setAvailable(body.getBoundingClientRect().height);
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(body);
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  const height = sheetHeight(snap, available);
  useEffect(() => {
    onPaddingChange({
      top: 24,
      right: 24,
      left: 24,
      bottom: sheet ? Math.min(height + 12, Math.max(24, available - 72)) : 24,
    });
  }, [sheet, height, available, onPaddingChange]);
  const change = (direction: number) =>
    setSnap((value) => {
      const values: SheetSnap[] = ['peek', 'half', 'full'];
      return values[Math.min(2, Math.max(0, values.indexOf(value) + direction))]!;
    });
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    startY.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (startY.current === null) return;
    const delta = event.clientY - startY.current;
    startY.current = null;
    if (Math.abs(delta) >= 40) {
      suppressClick.current = true;
      change(delta < 0 ? 1 : -1);
    }
  };
  return (
    <Box
      data-testid="view-panel"
      ref={hostRef}
      sx={{
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: '#fff',
        color: '#182b32',
        ...(sheet
          ? {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height,
              zIndex: 2,
              borderRadius: '24px 24px 0 0',
              boxShadow: '0 -4px 16px #00000012',
            }
          : { gridArea: 'panel', overflow: 'hidden' }),
      }}
    >
      {sheet && (
        <Box sx={{ display: 'flex', alignItems: 'center', px: 2 }}>
          <Box
            role="button"
            aria-label="시트 크기 조절"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              startY.current = null;
              suppressClick.current = true;
            }}
            onClick={() => {
              if (suppressClick.current) suppressClick.current = false;
              else change(1);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                change(1);
              }
            }}
            tabIndex={0}
            sx={{ minHeight: 44, flex: 1, touchAction: 'none' }}
          >
            <Typography sx={{ fontWeight: 700 }}>저장한 장소</Typography>
          </Box>
          <Button onClick={() => setSnap(snap === 'full' ? 'peek' : 'full')}>
            {snap === 'full' ? '접기' : '목록 보기'}
          </Button>
        </Box>
      )}
      <Box
        data-testid="view-scroll"
        ref={attachScroll}
        sx={{ overflow: 'auto', overscrollBehavior: 'contain', minHeight: 0, flex: 1 }}
      >
        <ViewScrollContext value={{ ref: scrollRef, element: scrollElement, view }}>
          {children}
        </ViewScrollContext>
      </Box>
    </Box>
  );
}
