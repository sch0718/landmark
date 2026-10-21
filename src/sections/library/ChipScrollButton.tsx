import Box from '@mui/material/Box';
import { useEffect, useState, type ReactNode, type RefObject } from 'react';

type Props = {
  /** -1이면 왼쪽, 1이면 오른쪽 단추. */
  side: -1 | 1;
  /** 칩 줄. 부모(양끝 단추를 담는 틀)의 너비로 넘침을 잰다. */
  rowRef: RefObject<HTMLDivElement | null>;
  label: string;
  /** 칩이 바뀌면 다시 잰다. */
  watch: ReactNode;
};

type Edges = { overflow: boolean; left: boolean; right: boolean };

/**
 * 넓은·중간 화면 칩 줄 한쪽 끝의 스크롤 단추. 줄이 넘칠 때만 보이고, 그 방향 끝이면 꺼진다.
 * 첫 로딩 예산을 아끼려고 `ChipScrollRow`가 나중에 받는다(받기 전·실패 때는 단추 없이 손으로 넘긴다).
 */
export function ChipScrollButton({ side, rowRef, label, watch }: Props) {
  const [edges, setEdges] = useState<Edges>({ overflow: false, left: false, right: false });
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const frame = row.parentElement;
    const measure = () => {
      const next = {
        overflow: row.scrollWidth > (frame?.clientWidth || row.clientWidth) + 1,
        left: row.scrollLeft > 1,
        right: row.scrollLeft + row.clientWidth < row.scrollWidth - 1,
      };
      setEdges((old) =>
        old.overflow === next.overflow && old.left === next.left && old.right === next.right
          ? old
          : next,
      );
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(row);
    if (frame) observer?.observe(frame);
    for (const child of row.children) observer?.observe(child);
    row.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      row.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [rowRef, watch]);
  if (!edges.overflow) return null;
  return (
    <Box
      component="button"
      type="button"
      aria-label={`${label} ${side === -1 ? '왼쪽' : '오른쪽'}으로 스크롤`}
      disabled={side === -1 ? !edges.left : !edges.right}
      onClick={() => {
        const row = rowRef.current;
        row?.scrollBy({ left: side * Math.max(120, row.clientWidth * 0.75), behavior: 'smooth' });
      }}
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
      {side === -1 ? '◀' : '▶'}
    </Box>
  );
}
