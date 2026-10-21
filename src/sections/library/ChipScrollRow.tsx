import Box from '@mui/material/Box';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLayout } from 'src/sections/shell/use-layout';

type Props = { label: string; children: ReactNode };

/** 넘치는 칩 줄에만 스크롤 단추를 더한다. 휴대폰은 손가락으로 넘긴다. */
export function ChipScrollRow({ label, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const compact = useLayout() === 'compact';
  const [edges, setEdges] = useState({ overflow: false, left: false, right: false });
  const measure = () => {
    const row = ref.current;
    if (!row) return;
    const next = {
      overflow: row.scrollWidth > (frameRef.current?.clientWidth || row.clientWidth) + 1,
      left: row.scrollLeft > 1,
      right: row.scrollLeft + row.clientWidth < row.scrollWidth - 1,
    };
    setEdges((old) =>
      old.overflow === next.overflow && old.left === next.left && old.right === next.right
        ? old
        : next,
    );
  };
  useEffect(() => {
    measure();
    const row = ref.current;
    if (!row) return;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(row);
    if (frameRef.current) observer?.observe(frameRef.current);
    for (const child of row.children) observer?.observe(child);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [children, compact]);
  const scroll = (direction: number) => {
    const row = ref.current;
    row?.scrollBy({ left: direction * Math.max(120, row.clientWidth * 0.75), behavior: 'smooth' });
  };
  const button = (direction: -1 | 1) => (
    <Box
      component="button"
      type="button"
      aria-label={`${label} ${direction === -1 ? '왼쪽' : '오른쪽'}으로 스크롤`}
      disabled={direction === -1 ? !edges.left : !edges.right}
      onClick={() => scroll(direction)}
      sx={{
        flex: 'none',
        width: 44,
        minHeight: 44,
        border: 0,
        background: 'transparent',
        color: 'var(--tm-text-secondary)',
        cursor: 'pointer',
        '&:disabled': { opacity: 0.35 },
      }}
    >
      {direction === -1 ? '◀' : '▶'}
    </Box>
  );
  return (
    <Box ref={frameRef} sx={{ display: 'flex', minWidth: 0 }}>
      {!compact && edges.overflow && button(-1)}
      <Box
        ref={ref}
        role="group"
        aria-label={label}
        onScroll={measure}
        sx={{
          display: 'flex',
          flex: 1,
          minWidth: 0,
          gap: 0.5,
          overflowX: 'auto',
          px: 2,
          scrollbarWidth: 'none',
        }}
      >
        {children}
      </Box>
      {!compact && edges.overflow && button(1)}
    </Box>
  );
}
