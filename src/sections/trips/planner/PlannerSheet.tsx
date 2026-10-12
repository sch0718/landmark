import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { useRef, useState, type PointerEvent } from 'react';
import { visibleCandidates } from 'src/domain/trips/query';
import type { Library } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';
import { CandidatePanel } from 'src/sections/trips/planner/CandidatePanel';
import { DayTimeline } from 'src/sections/trips/planner/DayTimeline';

export type SheetSnap = 'collapsed' | 'half' | 'full';

/** 손잡이를 이만큼(px) 넘게 끌면 끈 방향으로 한 단계 바꾼다. 그보다 짧으면 누른 것으로 본다. */
const DRAG_STEP_PX = 24;
const ORDER: SheetSnap[] = ['collapsed', 'half', 'full'];
/** 손잡이(44) + 탭 줄(48). 접힘이면 이것만 보인다. */
const COLLAPSED_PX = 92;
const HEIGHT: Record<SheetSnap, string> = {
  collapsed: `${COLLAPSED_PX}px`,
  half: '50%',
  full: 'calc(100% - 24px)',
};

type Props = {
  trip: Trip;
  library: Library;
  dayIndex: number;
  onSelectDay(dayIndex: number): void;
};

/**
 * 좁은 화면의 일정 시트(스펙 §2.3): 지도 위 아래쪽에서 끌어올린다. 높이는 접힘(탭 줄만)·반쯤·거의 전체.
 * 손잡이를 누르면 접힘 → 반쯤 → 거의 전체 → 접힘으로 돌고, 위아래로 끌면 그 방향으로 한 단계 바뀐다.
 * 탭은 `후보 N`, `Day 1`, `Day 2` …이고 내용은 넓은 화면의 후보 칸·시간표와 같다.
 */
export function PlannerSheet({ trip, library, dayIndex, onSelectDay }: Props) {
  const [snap, setSnap] = useState<SheetSnap>('half');
  const [tab, setTab] = useState<'candidates' | 'day'>('candidates');
  const drag = useRef<{ y: number; moved: boolean } | null>(null);
  const candidateCount = visibleCandidates(library, trip).length;

  const step = (direction: 1 | -1) => {
    const next = ORDER[ORDER.indexOf(snap) + direction];
    if (next !== undefined) setSnap(next);
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    drag.current = { y: event.clientY, moved: false };
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = drag.current;
    if (start === null) return;
    const dy = event.clientY - start.y;
    if (Math.abs(dy) > DRAG_STEP_PX) {
      start.moved = true; // 뒤따르는 click은 무시한다
      step(dy < 0 ? 1 : -1);
    }
  };
  const onHandleClick = () => {
    const moved = drag.current?.moved === true;
    drag.current = null;
    if (moved) return;
    setSnap(ORDER[(ORDER.indexOf(snap) + 1) % ORDER.length]!);
  };

  const value = tab === 'candidates' ? 'candidates' : dayIndex;
  const select = (next: 'candidates' | number) => {
    if (next === 'candidates') setTab('candidates');
    else {
      setTab('day');
      onSelectDay(next);
    }
    if (snap === 'collapsed') setSnap('half');
  };

  return (
    <Box
      component="section"
      aria-label="일정 시트"
      data-snap={snap}
      sx={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 2,
        height: HEIGHT[snap],
        minHeight: COLLAPSED_PX,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'var(--tm-bg-surface)',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        boxShadow: 'var(--tm-shadow-2)',
        transition: 'height 200ms ease',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      <Box
        component="button"
        type="button"
        aria-label="시트 높이 바꾸기"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onClick={onHandleClick}
        sx={{
          flex: 'none',
          height: 44,
          width: '100%',
          display: 'grid',
          placeItems: 'center',
          border: 0,
          background: 'transparent',
          cursor: 'grab',
          touchAction: 'none',
          '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: -2 },
        }}
      >
        <Box
          aria-hidden="true"
          sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'var(--tm-border)' }}
        />
      </Box>
      <Tabs
        value={value}
        onChange={(_event, next: 'candidates' | number) => select(next)}
        onClick={() => {
          // 이미 고른 탭을 다시 눌러도 접힌 시트는 연다.
          if (snap === 'collapsed') setSnap('half');
        }}
        variant="scrollable"
        scrollButtons={false}
        aria-label="일정 시트 탭"
        sx={{ flex: 'none', minHeight: 48, borderBottom: '1px solid var(--tm-border)' }}
      >
        <Tab value="candidates" label={`후보 ${candidateCount}`} sx={{ textTransform: 'none' }} />
        {trip.days.map((_, i) => (
          <Tab key={i} value={i} label={`Day ${i + 1}`} sx={{ textTransform: 'none' }} />
        ))}
      </Tabs>
      <Box
        role="tabpanel"
        hidden={snap === 'collapsed'}
        sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}
      >
        {snap !== 'collapsed' &&
          (tab === 'candidates' ? (
            <CandidatePanel trip={trip} dayIndex={dayIndex} fill={false} />
          ) : (
            <DayTimeline trip={trip} dayIndex={dayIndex} />
          ))}
      </Box>
    </Box>
  );
}
