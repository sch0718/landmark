import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import { useAtom, useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { PanelLeftOpenIcon } from 'src/components/icons';
import type { MapPadding } from 'src/components/map/MapAdapter';
import { hiddenPlaceCount } from 'src/domain/trips/query';
import { paths } from 'src/routes/paths';
import type { Library } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';
import { PlaceDetail } from 'src/sections/place/PlaceDetail';
import { DETAIL_WIDTH, LIST_WIDTH } from 'src/sections/shell/pane-widths';
import { useLayout } from 'src/sections/shell/use-layout';
import { CandidatePanel } from 'src/sections/trips/planner/CandidatePanel';
import { DayTabs, DayTimeline } from 'src/sections/trips/planner/DayTimeline';
import { MapCard } from 'src/sections/trips/planner/MapCard';
import { COLLAPSED_PX, PlannerSheet } from 'src/sections/trips/planner/PlannerSheet';
import { TripMap } from 'src/sections/trips/planner/TripMap';
import { useDayPlan, type DayPlan } from 'src/sections/trips/planner/use-day-plan';
import { libraryAtom } from 'src/stores/library-state';
import { mapCardAtom, selectedDayAtom } from 'src/stores/trip-planner';

const OFFLINE_NOTICE = '인터넷에 연결되지 않아 이동 시간은 어림값이에요';

const EDGE = 40;
const WIDE_PADDING: MapPadding = { top: EDGE, right: EDGE, bottom: EDGE, left: EDGE };
/** 중간 폭: 시간표 칸이 지도 오른쪽을 덮는다. */
const MEDIUM_PADDING: MapPadding = { ...WIDE_PADDING, right: DETAIL_WIDTH + EDGE };
/** 좁은 화면: 접힌 시트가 지도 아래를 덮는다. */
const COMPACT_PADDING: MapPadding = { ...WIDE_PADDING, bottom: COLLAPSED_PX + EDGE };

/** 지도 칸. 지도 위에 오프라인 안내·카드 같은 것을 덮는다. */
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

/** 계획 화면 위에 한 번 보이는 오프라인 안내(스펙 §6). 지도 칸 위쪽 가운데에 덮는다. */
function OfflineNotice() {
  return (
    <Box
      role="status"
      sx={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1,
        width: 'max-content',
        maxWidth: 'calc(100% - 120px)',
        px: 1.5,
        py: 1,
        borderRadius: 'var(--tm-radius-md)',
        bgcolor: 'var(--tm-bg-surface)',
        boxShadow: 'var(--tm-shadow-2)',
        fontSize: 13,
        color: 'var(--tm-text-secondary)',
        textAlign: 'center',
      }}
    >
      {OFFLINE_NOTICE}
    </Box>
  );
}

/** `상세`: 기존 장소 상세와 `← 일정으로`. */
function DetailPane({ placeId, onBack }: { placeId: string; onBack(): void }) {
  return (
    <>
      <Box sx={{ flex: 'none', px: 1, py: 0.5, borderBottom: '1px solid var(--tm-border)' }}>
        <Button onClick={onBack} sx={{ minHeight: 44, textTransform: 'none', fontWeight: 700 }}>
          ← 일정으로
        </Button>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <PlaceDetail placeId={placeId} />
      </Box>
    </>
  );
}

/**
 * 넓은·중간 폭의 Day 시간표 칸. 중간 폭에서는 지도 오른쪽을 덮는다.
 * 카드의 `상세`를 누르면 이 자리에 장소 상세를 보인다(`← 일정으로`로 돌아옴).
 */
function TimelinePane({
  trip,
  dayIndex,
  plan,
  onSelectDay,
  overlay,
  detailId,
  onCloseDetail,
}: {
  trip: Trip;
  dayIndex: number;
  plan: DayPlan;
  onSelectDay(dayIndex: number): void;
  overlay: boolean;
  detailId: string | null;
  onCloseDetail(): void;
}) {
  return (
    <Box
      component="section"
      aria-label={detailId === null ? 'Day 시간표' : '장소 상세'}
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
      {detailId !== null ? (
        <DetailPane placeId={detailId} onBack={onCloseDetail} />
      ) : (
        <>
          <DayTabs trip={trip} dayIndex={dayIndex} onSelect={onSelectDay} />
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <DayTimeline trip={trip} dayIndex={dayIndex} plan={plan} />
          </Box>
        </>
      )}
    </Box>
  );
}

function Planner({ trip, library }: { trip: Trip; library: Library }) {
  const layout = useLayout();
  const [dayIndex, selectDay] = useSelectedDay(trip);
  const [candidatesOpen, setCandidatesOpen] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  // 고른 Day의 구간·시각은 여기서 한 번 구해 지도·시간표·오프라인 안내가 함께 쓴다. 좁은 화면에서 시트가
  // 후보 탭이어도 경로 요청이 지도와 함께 시작된다.
  const plan = useDayPlan(trip.id, dayIndex);
  const [card, setCard] = useAtom(mapCardAtom);
  const cardPlaceId = card !== null && card.tripId === trip.id ? card.placeId : null;
  const openCard = useCallback(
    (placeId: string) => setCard({ tripId: trip.id, placeId }),
    [setCard, trip.id],
  );
  const closeCard = useCallback(() => setCard(null), [setCard]);
  // 화면을 떠나면 카드를 닫는다(다시 들어왔을 때 옛 카드가 떠 있지 않게).
  useEffect(() => () => setCard(null), [setCard]);
  useHiddenPlaceToast(library, trip);

  const compact = layout === 'compact';
  const medium = layout === 'medium';
  const mapArea = (padding: MapPadding, extra?: ReactNode) => (
    <MapArea>
      <TripMap
        trip={trip}
        dayIndex={dayIndex}
        legs={plan.legs}
        padding={padding}
        cardPlaceId={cardPlaceId}
        onOpenCard={openCard}
      />
      {plan.offline && <OfflineNotice />}
      {extra}
      {cardPlaceId !== null && (
        <Box
          sx={{
            position: 'absolute',
            zIndex: 3,
            left: compact ? 8 : 16,
            bottom: compact ? COLLAPSED_PX + 8 : 16,
            width: compact ? 'calc(100% - 16px)' : 'min(360px, calc(100% - 32px))',
          }}
        >
          <MapCard
            key={cardPlaceId}
            trip={trip}
            dayIndex={dayIndex}
            placeId={cardPlaceId}
            onClose={closeCard}
            onDetail={setDetailId}
          />
        </Box>
      )}
    </MapArea>
  );

  if (compact) {
    return (
      <Box sx={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
        {mapArea(COMPACT_PADDING)}
        <PlannerSheet
          trip={trip}
          library={library}
          dayIndex={dayIndex}
          plan={plan}
          onSelectDay={selectDay}
        />
        {detailId !== null && (
          <Box
            component="section"
            aria-label="장소 상세"
            sx={{
              position: 'absolute',
              inset: 0,
              zIndex: 4,
              display: 'flex',
              flexDirection: 'column',
              bgcolor: 'var(--tm-bg-surface)',
            }}
          >
            <DetailPane placeId={detailId} onBack={() => setDetailId(null)} />
          </Box>
        )}
      </Box>
    );
  }

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
      {mapArea(
        medium ? MEDIUM_PADDING : WIDE_PADDING,
        !showCandidates && (
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
        ),
      )}
      <TimelinePane
        trip={trip}
        dayIndex={dayIndex}
        plan={plan}
        onSelectDay={selectDay}
        overlay={medium}
        detailId={detailId}
        onCloseDetail={() => setDetailId(null)}
      />
    </Box>
  );
}

/**
 * `/trips/:id` 계획 화면(스펙 §2.3). 넓은 화면은 [후보 칸][지도][Day 시간표], 중간 폭은 후보 칸을 접을 수 있고
 * 시간표가 지도 위를 덮으며, 좁은 화면은 지도 위에 끌어올리는 일정 시트를 둔다. 핀·행을 누르면 지도 위 카드를 연다. 셸의 `Outlet` 본문을 높이 100%로 채운다.
 */
export function TripPlannerPage() {
  const { id = '' } = useParams();
  const library = useAtomValue(libraryAtom);
  const trip = library.trips[id];
  if (trip === undefined || trip.deletedAt !== null) return <NotFound />;
  // 여행이 바뀌면 화면 상태(후보 칸 접기·토스트 확인)를 새로 시작한다.
  return <Planner key={trip.id} trip={trip} library={library} />;
}
