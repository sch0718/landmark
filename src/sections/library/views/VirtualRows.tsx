import Box from '@mui/material/Box';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

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
  /**
   * 그 줄이 보이게 스크롤하라는 요청. `seq`가 처음 보는 값일 때만 한 번 처리한다(`index`가 음수면 줄이 없어
   * 건너뛴다). 목록이 만들어질 때 이미 있던 요청은 지난 것이라 처리하지 않는다.
   */
  scrollTo?: { index: number; seq: number } | null;
};

/** `scrollTo` 요청을 처음 보는 `seq`마다 한 번 `run`으로 넘긴다. */
function useScrollRequest(request: Props['scrollTo'], run: (index: number) => void) {
  const handled = useRef(request?.seq ?? null);
  useEffect(() => {
    if (!request || request.seq === handled.current) return;
    handled.current = request.seq;
    if (request.index >= 0) run(request.index);
  });
}

/**
 * 스크롤 조상(`scrollElement`) 안에서 보이는 줄만 그리는 목록. 목록 위에 다른 내용(필터·벤토)이 있어도
 * 목록이 시작하는 위치(`scrollMargin`)를 재서 맞춘다.
 */
function Virtualized({
  count,
  estimate,
  gap,
  label,
  scrollElement,
  getKey,
  renderItem,
  scrollTo,
}: Props) {
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
  useScrollRequest(scrollTo, (index) => virtualizer.scrollToIndex(index, { align: 'auto' }));

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
  return <PlainRows {...props} />;
}

function PlainRows(props: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  useScrollRequest(props.scrollTo, (index) =>
    // jsdom 같은 환경에는 없을 수 있다.
    listRef.current?.children[index]?.scrollIntoView?.({ block: 'nearest' }),
  );
  return (
    <Box
      component="ul"
      ref={listRef}
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
