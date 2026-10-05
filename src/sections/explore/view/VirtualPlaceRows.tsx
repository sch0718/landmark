import Box from '@mui/material/Box';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { useAtomValue, useStore } from 'jotai';
import {
  memo,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type FocusEvent,
} from 'react';
import { ViewScrollContext } from 'src/sections/views/view-scroll-context';
import {
  selectedPlaceScrollRequestAtom,
  viewScrollAtom,
} from 'src/sections/views/store/view-session';
import { selectedPlaceAtom } from 'src/stores/ui-store';
import {
  cacheKey,
  columnsFromTemplate,
  placeScrollAckAtom,
  rowsOf,
  virtualPlaceCacheAtom,
  type PlaceVariant,
  type PlaceAnchor,
} from './virtual-place-state';

type Props = {
  keys: string[];
  variant: PlaceVariant;
  content: object;
  ready: boolean;
  renderPlace(key: string): ReactNode;
};
type Entry = {
  canRestore(host: HTMLDivElement): boolean;
  activate(host: HTMLDivElement): void;
};
type Geometry = {
  host: HTMLDivElement;
  width: number;
  columns: number;
  template: string;
  gap: number;
  margin: number;
};
const gridSx = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2,minmax(0,1fr))',
  '@media (min-width:768px)': { gridTemplateColumns: 'repeat(auto-fit,minmax(160px,280px))' },
  gap: 1.25,
};

export function VirtualPlaceRows(props: Props) {
  const context = useContext(ViewScrollContext);
  const root = useRef<HTMLDivElement>(null),
    probe = useRef<HTMLDivElement>(null);
  const activeHost = useRef<HTMLDivElement | null>(null);
  const entry = useMemo<Entry>(
    () => ({
      canRestore: (host) => activeHost.current !== host,
      activate: (host) => {
        activeHost.current = host;
      },
    }),
    [],
  );
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [probeCount, setProbeCount] = useState(props.variant === 'list' ? 1 : 2);
  useLayoutEffect(() => {
    const host = context?.element,
      box = root.current,
      ruler = probe.current;
    if (props.keys.length <= 60 || !host || !box || !ruler) return;
    const media = matchMedia('(min-width:768px)');
    const measure = () => {
      const style = getComputedStyle(ruler),
        rect = box.getBoundingClientRect();
      const width = ruler.getBoundingClientRect().width;
      const count =
        props.variant === 'list'
          ? 1
          : media.matches
            ? Math.min(props.keys.length, Math.max(2, Math.ceil(width / 160) + 1))
            : 2;
      if (count !== probeCount) {
        setProbeCount(count);
        setGeometry(null);
        return;
      }
      const template = style.gridTemplateColumns;
      const next = {
        host,
        width,
        columns: props.variant === 'grid' ? columnsFromTemplate(template) : 1,
        template,
        gap: props.variant === 'grid' ? parseFloat(style.rowGap) || 0 : 0,
        margin: rect.top - host.getBoundingClientRect().top - host.clientTop + host.scrollTop,
      };
      setGeometry((old) =>
        old &&
        Object.keys(next).every((key) => old[key as keyof Geometry] === next[key as keyof Geometry])
          ? old
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    observer.observe(box);
    observer.observe(ruler);
    if (box.parentElement) observer.observe(box.parentElement);
    if (host.firstElementChild) observer.observe(host.firstElementChild);
    media.addEventListener('change', measure);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', measure);
    };
  }, [context?.element, props.variant, props.keys.length, probeCount]);
  const virtual = !!context && props.keys.length > 60;
  return (
    <Box sx={{ p: props.variant === 'grid' ? 1.5 : 0 }}>
      <Box
        ref={root}
        sx={{ position: 'relative' }}
        data-place-count={props.keys.length}
        data-place-variant={props.variant}
      >
        <Box
          ref={probe}
          aria-hidden
          sx={{
            ...gridSx,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 0,
            overflow: 'hidden',
            visibility: 'hidden',
            pointerEvents: 'none',
          }}
        >
          {Array.from({ length: probeCount }, (_, index) => (
            <span key={index} />
          ))}
        </Box>
        {virtual ? (
          geometry && geometry.host === context.element ? (
            <MeasuredPlaceRows
              key={cacheKey(props.variant, geometry.width, geometry.columns, props.keys)}
              {...props}
              entry={entry}
              geometry={geometry}
              host={context.element}
              view={context.view}
            />
          ) : null
        ) : (
          <StaticPlaceRows {...props} entry={entry} />
        )}
      </Box>
    </Box>
  );
}

function isAtOffset(host: HTMLDivElement, offset: number) {
  return Math.abs(host.scrollTop - offset) < 1;
}

function restoreOffset(host: HTMLDivElement, offset: number) {
  host.scrollTop = offset;
}

function StaticPlaceRows({
  keys,
  variant,
  content,
  ready,
  renderPlace,
  entry,
}: Props & { entry: Entry }) {
  const context = useContext(ViewScrollContext),
    store = useStore();
  const request = useAtomValue(selectedPlaceScrollRequestAtom),
    selected = useAtomValue(selectedPlaceAtom),
    ack = useAtomValue(placeScrollAckAtom);
  const nodes = useRef(new Map<string, HTMLElement>());
  const latestContent = useRef(content);
  useLayoutEffect(() => {
    latestContent.current = content;
  }, [content]);
  const identity = cacheKey(variant, context?.element?.clientWidth ?? 0, 1, keys);
  useLayoutEffect(() => {
    const host = context?.element;
    if (!host || !ready) return;
    const cached = store.get(virtualPlaceCacheAtom)[context.view];
    restoreOffset(host, cached?.key === identity ? cached.offset : 0);
    entry.activate(host);
    return () => {
      store.set(virtualPlaceCacheAtom, (old) => ({
        ...old,
        [context.view]: {
          key: identity,
          content: latestContent.current,
          offset: host.scrollTop,
          measurements: [],
        },
      }));
    };
  }, [context?.element, context?.view, store, identity, ready, entry]);
  useLayoutEffect(() => {
    if (!ready || request <= ack) return;
    const node = selected ? nodes.current.get(selected) : undefined;
    if (!node) {
      store.set(placeScrollAckAtom, request);
      return;
    }
    node.scrollIntoView?.({ block: 'nearest' });
    let frame = 0;
    const finish = () => {
      const host = context?.element;
      if (!host) {
        store.set(placeScrollAckAtom, request);
        return;
      }
      const rect = node.getBoundingClientRect(),
        bounds = host.getBoundingClientRect();
      const top = bounds.top + host.clientTop,
        bottom = top + host.clientHeight;
      if (
        rect.height > 0 &&
        rect.top >= top - 1 &&
        Math.min(rect.bottom, rect.top + host.clientHeight) <= bottom + 1
      ) {
        store.set(placeScrollAckAtom, request);
        return;
      }
      node.scrollIntoView?.({ block: rect.height > host.clientHeight ? 'start' : 'nearest' });
      frame = requestAnimationFrame(finish);
    };
    frame = requestAnimationFrame(finish);
    return () => cancelAnimationFrame(frame);
  }, [ready, request, ack, selected, keys, store, context?.element]);
  return (
    <Box
      component={variant === 'list' ? 'ul' : 'div'}
      aria-label={variant === 'list' ? '장소 목록' : undefined}
      sx={variant === 'grid' ? gridSx : { listStyle: 'none', m: 0, p: 0 }}
    >
      {keys.map((key) => (
        <Box
          component={variant === 'list' ? 'li' : 'div'}
          key={key}
          data-place-key={key}
          ref={(node: HTMLElement | null) => {
            if (node) nodes.current.set(key, node);
            else nodes.current.delete(key);
          }}
        >
          {renderPlace(key)}
        </Box>
      ))}
    </Box>
  );
}

const PlaceContent = memo(function PlaceContent({
  placeKey,
  renderPlace,
}: {
  placeKey: string;
  renderPlace: Props['renderPlace'];
}) {
  return renderPlace(placeKey);
});

function MeasuredPlaceRows({
  keys,
  variant,
  content,
  ready,
  renderPlace,
  geometry,
  entry,
  host,
  view,
}: Props & {
  entry: Entry;
  geometry: Geometry;
  host: HTMLDivElement;
  view: 'map' | 'day' | 'places';
}) {
  'use no memo';
  const store = useStore();
  const request = useAtomValue(selectedPlaceScrollRequestAtom),
    selected = useAtomValue(selectedPlaceAtom),
    ack = useAtomValue(placeScrollAckAtom);
  const rows = useMemo(() => rowsOf(keys, geometry.columns), [keys, geometry.columns]);
  const nodes = useRef(new Map<string, HTMLElement>());
  const previousContent = useRef(content);
  const latestContent = useRef(content);
  useLayoutEffect(() => {
    latestContent.current = content;
  }, [content]);
  const getItemKey = useCallback((index: number) => JSON.stringify(rows[index]), [rows]);
  const [focused, setFocused] = useState<number | null>(null);
  const index = selected ? keys.indexOf(selected) : -1;
  const pending =
    ready && request > ack && index >= 0 ? Math.floor(index / geometry.columns) : null;
  const signature = cacheKey(variant, geometry.width, geometry.columns, keys);
  const [initial] = useState(() => {
    const cached = store.get(virtualPlaceCacheAtom)[view];
    return entry.canRestore(host) && cached?.key === signature
      ? {
          offset: cached.offset,
          measurements: cached.content === content ? cached.measurements : [],
          anchor: cached.content === content ? undefined : cached.anchor,
        }
      : undefined;
  });
  useLayoutEffect(() => {
    entry.activate(host);
  }, [entry, host]);
  const [contentAnchor, setContentAnchor] = useState<PlaceAnchor | null>(initial?.anchor ?? null);
  // The component opts out of compiler memoization for TanStack's mutable virtualizer.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: rows.length,
    useAnimationFrameWithResizeObserver: true,
    useScrollendEvent: true,
    getScrollElement: () => host,
    estimateSize: () => (variant === 'grid' ? 280 : 170),
    getItemKey,
    overscan: 3,
    gap: geometry.gap,
    scrollMargin: geometry.margin,
    initialOffset: initial?.offset ?? 0,
    initialMeasurementsCache: initial?.measurements,
    rangeExtractor: (range) => {
      const indexes = new Set(defaultRangeExtractor(range));
      if (pending !== null) indexes.add(pending);
      if (contentAnchor !== null) indexes.add(contentAnchor.index);
      if (focused !== null)
        for (const n of [focused - 1, focused, focused + 1])
          if (n >= 0 && n < rows.length) indexes.add(n);
      return [...indexes].sort((a, b) => a - b);
    },
  });
  useLayoutEffect(() => {
    return () => {
      const offset = host.scrollTop;
      const item = virtualizer.getVirtualItemForOffset(offset);
      const anchor = item ? { index: item.index, delta: offset - item.start } : undefined;
      store.set(virtualPlaceCacheAtom, (old) => ({
        ...old,
        [view]: {
          key: signature,
          content: latestContent.current,
          offset,
          measurements: virtualizer.takeSnapshot(),
          anchor,
        },
      }));
      store.set(viewScrollAtom, (old) => ({ ...old, [view]: offset }));
    };
  }, [store, view, signature, host, virtualizer]);
  useLayoutEffect(() => {
    if (previousContent.current === content) return;
    previousContent.current = content;
    const item = virtualizer.getVirtualItemForOffset(host.scrollTop);
    const anchor =
      contentAnchor ?? (item ? { index: item.index, delta: host.scrollTop - item.start } : null);
    virtualizer.measure();
    setContentAnchor(anchor);
  }, [content, contentAnchor, host, virtualizer]);
  useLayoutEffect(() => {
    if (!contentAnchor) return;
    if (request > ack) {
      setContentAnchor(null);
      return;
    }
    let frame = 0,
      stable = 0,
      previousSize = -1;
    const restore = () => {
      const key = rows[contentAnchor.index]?.[0];
      const row = key ? nodes.current.get(key)?.parentElement : null;
      if (!row) {
        frame = requestAnimationFrame(restore);
        return;
      }
      for (const node of nodes.current.values()) {
        const element = node.parentElement;
        if (element) virtualizer.measureElement(element);
      }
      const offset = virtualizer.getOffsetForIndex(contentAnchor.index, 'start');
      if (offset) {
        const delta = Math.min(
          contentAnchor.delta,
          Math.max(0, row.getBoundingClientRect().height - 1),
        );
        const maximum = Math.max(0, host.scrollHeight - host.clientHeight);
        const target = Math.min(maximum, Math.max(0, offset[0] + delta));
        const size = virtualizer.getTotalSize();
        stable = isAtOffset(host, target) && previousSize === size ? stable + 1 : 0;
        previousSize = size;
        if (stable >= 2) {
          setContentAnchor(null);
          return;
        }
        virtualizer.scrollToOffset(target, { behavior: 'auto' });
      }
      frame = requestAnimationFrame(restore);
    };
    frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [contentAnchor, request, ack, rows, host, virtualizer]);
  useLayoutEffect(() => {
    if (!ready || request <= ack) return;
    if (pending === null || !selected) {
      store.set(placeScrollAckAtom, request);
      return;
    }
    let frame = 0,
      stable = 0,
      previousSize = -1,
      cancelled = false;
    const finish = () => {
      if (cancelled) return;
      const node = nodes.current.get(selected);
      if (node) {
        const row = node.parentElement;
        if (row) virtualizer.measureElement(row);
        const rect = node.getBoundingClientRect(),
          box = host.getBoundingClientRect();
        const top = box.top + host.clientTop,
          bottom = top + host.clientHeight;
        if (
          rect.height > 0 &&
          rect.top >= top - 1 &&
          Math.min(rect.bottom, rect.top + host.clientHeight) <= bottom + 1
        ) {
          const size = virtualizer.getTotalSize();
          stable = previousSize === size ? stable + 1 : 0;
          previousSize = size;
          if (stable >= 2) {
            store.set(placeScrollAckAtom, request);
            return;
          }
          frame = requestAnimationFrame(finish);
          return;
        }
        stable = 0;
      }
      virtualizer.scrollToIndex(pending, { align: 'start', behavior: 'auto' });
      frame = requestAnimationFrame(finish);
    };
    virtualizer.scrollToIndex(pending, { align: 'start', behavior: 'auto' });
    frame = requestAnimationFrame(finish);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [ready, request, ack, selected, pending, store, host, virtualizer]);
  const items = virtualizer.getVirtualItems();
  return (
    <Box
      data-place-columns={geometry.columns}
      component={variant === 'list' ? 'ul' : 'div'}
      aria-label={variant === 'list' ? '장소 목록' : undefined}
      sx={{
        height: virtualizer.getTotalSize(),
        position: 'relative',
        listStyle: 'none',
        m: 0,
        p: 0,
      }}
    >
      {items.map((item) => (
        <Box
          component={variant === 'list' ? 'li' : 'div'}
          key={String(item.key)}
          data-index={item.index}
          ref={virtualizer.measureElement}
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${item.start - geometry.margin}px)`,
            display: variant === 'grid' ? 'grid' : 'block',
            gridTemplateColumns: geometry.template,
            columnGap: `${geometry.gap}px`,
          }}
          onFocusCapture={() => setFocused(item.index)}
          onBlur={(event: FocusEvent<HTMLElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(null);
          }}
        >
          {rows[item.index]!.map((key) => (
            <Box
              key={key}
              data-place-key={key}
              ref={(node: HTMLElement | null) => {
                if (node) nodes.current.set(key, node);
                else nodes.current.delete(key);
              }}
            >
              <PlaceContent placeKey={key} renderPlace={renderPlace} />
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
