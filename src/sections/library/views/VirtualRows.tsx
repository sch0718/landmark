import Box from '@mui/material/Box';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** 이 개수를 넘으면 보이는 줄만 그린다. 그 아래는 전부 그려도 가볍다. */
export const VIRTUALIZE_AFTER = 60;

type Props = {
  count: number;
  /** 줄 높이 추정값(px). 그려진 뒤 실제 높이로 바뀐다. */
  estimate: number;
  /** 줄 사이 간격(px). */
  gap: number;
  label: string;
  /** 스크롤되는 조상. 아직 모르면 그리지 않는다. */
  scrollElement: HTMLElement | null;
  getKey(index: number): string;
  renderItem(index: number): ReactNode;
};

/**
 * 스크롤 조상(`scrollElement`) 안에서 보이는 줄만 그리는 목록. 목록 위에 다른 내용(필터·벤토)이 있어도
 * 목록이 시작하는 위치(`scrollMargin`)를 재서 맞춘다.
 */
function Virtualized({ count, estimate, gap, label, scrollElement, getKey, renderItem }: Props) {
  // TanStack의 가변 가상화 객체는 React Compiler의 메모이제이션과 맞지 않아 끈다.
  'use no memo';
  const listRef = useRef<HTMLUListElement>(null);
  const [margin, setMargin] = useState(0);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null || scrollElement === null) return;
    const measure = () => {
      const next =
        list.getBoundingClientRect().top -
        scrollElement.getBoundingClientRect().top +
        scrollElement.scrollTop;
      setMargin((prev) => (Math.abs(prev - next) < 1 ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    // 목록 위쪽 내용의 높이가 바뀌면(칩이 줄바꿈됨) 시작 위치가 달라진다.
    const observer = new ResizeObserver(measure);
    observer.observe(scrollElement);
    if (scrollElement.firstElementChild !== null) observer.observe(scrollElement.firstElementChild);
    return () => observer.disconnect();
  }, [scrollElement]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer<HTMLElement, HTMLLIElement>({
    count,
    getScrollElement: () => scrollElement,
    estimateSize: () => estimate,
    getItemKey: getKey,
    overscan: 6,
    gap,
    scrollMargin: margin,
  });

  return (
    <Box
      component="ul"
      ref={listRef}
      aria-label={label}
      sx={{
        listStyle: 'none',
        m: 0,
        p: 0,
        position: 'relative',
        height: virtualizer.getTotalSize(),
      }}
    >
      {virtualizer.getVirtualItems().map((item) => (
        <Box
          component="li"
          key={String(item.key)}
          data-index={item.index}
          ref={virtualizer.measureElement}
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${item.start - margin}px)`,
          }}
        >
          {renderItem(item.index)}
        </Box>
      ))}
    </Box>
  );
}

/** 장소 줄 목록. 많으면 가상화하고 적으면 전부 그린다. */
export function VirtualRows(props: Props) {
  if (props.count > VIRTUALIZE_AFTER) return <Virtualized {...props} />;
  return (
    <Box
      component="ul"
      aria-label={props.label}
      sx={{
        listStyle: 'none',
        m: 0,
        p: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: `${props.gap}px`,
      }}
    >
      {Array.from({ length: props.count }, (_, index) => (
        <li key={props.getKey(index)}>{props.renderItem(index)}</li>
      ))}
    </Box>
  );
}
