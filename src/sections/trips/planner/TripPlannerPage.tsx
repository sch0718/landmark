import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import { useAtom, useAtomValue } from 'jotai';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { PanelLeftOpenIcon } from 'src/components/icons';
import { hiddenPlaceCount } from 'src/domain/trips/query';
import { paths } from 'src/routes/paths';
import type { Library } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';
import { DETAIL_WIDTH, LIST_WIDTH } from 'src/sections/shell/pane-widths';
import { useLayout } from 'src/sections/shell/use-layout';
import { CandidatePanel } from 'src/sections/trips/planner/CandidatePanel';
import { DayTabs, DayTimeline } from 'src/sections/trips/planner/DayTimeline';
import { PlannerSheet } from 'src/sections/trips/planner/PlannerSheet';
import { libraryAtom } from 'src/stores/library-state';
import { selectedDayAtom } from 'src/stores/trip-planner';

/** 지도 자리. Task 10에서 지도를 넣는다. */
function MapArea({ children }: { children?: ReactNode }) {
  return (
    <Box
      component="section"
      aria-label="지도"
      sx={{
        flex: 1,
        minWidth: 0,
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        bgcolor: 'var(--tm-bg-base)',
      }}
    >
      {children}
    </Box>
  );
}

function NotFound() {
  return (
    <Box
      role="alert"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1.5,
        px: 3,
        py: 6,
        textAlign: 'center',
      }}
    >
      <Box component="p" sx={{ m: 0, fontWeight: 800 }}>
        여행을 찾지 못했어요
      </Box>
      <Button component={Link} to={paths.trips} variant="contained" sx={{ minHeight: 44 }}>
        여행 목록으로
      </Button>
    </Box>
  );
}

/** 지금 보는 Day. 기간이 줄어 없는 Day를 가리키면 마지막 Day로 본다. */
function useSelectedDay(trip: Trip): [number, (dayIndex: number) => void] {
  const [selected, setSelected] = useAtom(selectedDayAtom);
  const raw = selected[trip.id] ?? 0;
  const dayIndex = Math.min(Math.max(0, raw), trip.days.length - 1);
  const select = (next: number) => setSelected((prev) => ({ ...prev, [trip.id]: next }));
  return [dayIndex, select];
}

/** 화면을 열 때 지운 장소가 일정에서 빠졌으면 한 번 알린다(스펙 §3.3). */
function useHiddenPlaceToast(library: Library, trip: Trip) {
  const checked = useRef(false);
  const hidden = hiddenPlaceCount(library, trip);
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    if (hidden > 0) toast(`보관함에서 지운 ${hidden}곳은 일정에서 빠졌어요`);
  }, [hidden]);
}

/** 넓은·중간 폭의 Day 시간표 칸. 중간 폭에서는 지도 오른쪽을 덮는다. */
function TimelinePane({
  trip,
  dayIndex,
  onSelectDay,
  overlay,
}: {
  trip: Trip;
  dayIndex: number;
  onSelectDay(dayIndex: number): void;
  overlay: boolean;
}) {
  return (
    <Box
      component="section"
      aria-label="Day 시간표"
      sx={{
        width: DETAIL_WIDTH,
        maxWidth: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'var(--tm-bg-surface)',
        borderLeft: '1px solid var(--tm-border)',
        ...(overlay
          ? {
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              zIndex: 2,
              boxShadow: 'var(--tm-shadow-2)',
            }
          : { flex: 'none', height: '100%' }),
      }}
    >
      <DayTabs trip={trip} dayIndex={dayIndex} onSelect={onSelectDay} />
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <DayTimeline trip={trip} dayIndex={dayIndex} />
      </Box>
    </Box>
  );
}

function Planner({ trip, library }: { trip: Trip; library: Library }) {
  const layout = useLayout();
  const [dayIndex, selectDay] = useSelectedDay(trip);
  const [candidatesOpen, setCandidatesOpen] = useState(true);
  useHiddenPlaceToast(library, trip);

  if (layout === 'compact') {
    return (
      <Box sx={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
        <MapArea />
        <PlannerSheet trip={trip} library={library} dayIndex={dayIndex} onSelectDay={selectDay} />
      </Box>
    );
  }

  const medium = layout === 'medium';
  const showCandidates = !medium || candidatesOpen;
  return (
    <Box sx={{ height: '100%', display: 'flex', position: 'relative', overflow: 'hidden' }}>
      {showCandidates && (
        <Box
          sx={{
            flex: 'none',
            width: LIST_WIDTH,
            height: '100%',
            borderRight: '1px solid var(--tm-border)',
            bgcolor: 'var(--tm-bg-surface)',
          }}
        >
          <CandidatePanel
            trip={trip}
            dayIndex={dayIndex}
            onCollapse={medium ? () => setCandidatesOpen(false) : undefined}
          />
        </Box>
      )}
      <MapArea>
        {!showCandidates && (
          <IconButton
            aria-label="후보 칸 펼치기"
            onClick={() => setCandidatesOpen(true)}
            sx={{
              position: 'absolute',
              top: 8,
              left: 8,
              zIndex: 1,
              width: 44,
              height: 44,
              bgcolor: 'var(--tm-bg-surface)',
              boxShadow: 'var(--tm-shadow-2)',
              '&:hover': { bgcolor: 'var(--tm-bg-raised)' },
            }}
          >
            <PanelLeftOpenIcon aria-hidden="true" width={20} height={20} />
          </IconButton>
        )}
      </MapArea>
      <TimelinePane trip={trip} dayIndex={dayIndex} onSelectDay={selectDay} overlay={medium} />
    </Box>
  );
}

/**
 * `/trips/:id` 계획 화면(스펙 §2.3). 넓은 화면은 [후보 칸][지도][Day 시간표], 중간 폭은 후보 칸을 접을 수 있고
 * 시간표가 지도 위를 덮으며, 좁은 화면은 지도 위에 끌어올리는 일정 시트를 둔다. 셸의 `Outlet` 본문을 높이 100%로 채운다.
 */
export function TripPlannerPage() {
  const { id = '' } = useParams();
  const library = useAtomValue(libraryAtom);
  const trip = library.trips[id];
  if (trip === undefined || trip.deletedAt !== null) return <NotFound />;
  // 여행이 바뀌면 화면 상태(후보 칸 접기·토스트 확인)를 새로 시작한다.
  return <Planner key={trip.id} trip={trip} library={library} />;
}
