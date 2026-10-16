import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useAtom, useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { NavigationIcon, PanelLeftOpenIcon } from 'src/components/icons';
import type { MapPadding } from 'src/components/map/MapAdapter';
import { hiddenPlaceCount, locatePlace } from 'src/domain/trips/query';
import { todayStatus } from 'src/domain/trips/today';
import { useDocumentTitle } from 'src/lib/use-document-title';
import { paths } from 'src/routes/paths';
import type { Library } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';
import { PlaceDetail } from 'src/sections/place/PlaceDetail';
import { DETAIL_WIDTH, LIST_WIDTH } from 'src/sections/shell/pane-widths';
import { useLayout } from 'src/sections/shell/use-layout';
import { useCloseStaleSplit, useSplitPlan } from 'src/sections/trips/planner/AutoSplitPreview';
import { CandidatePanel } from 'src/sections/trips/planner/CandidatePanel';
import { DayTabs, DayTimeline } from 'src/sections/trips/planner/DayTimeline';
import { MapCard } from 'src/sections/trips/planner/MapCard';
import { PlannerDnd } from 'src/sections/trips/planner/PlannerDnd';
import { COLLAPSED_PX, PlannerSheet } from 'src/sections/trips/planner/PlannerSheet';
import { TripMap } from 'src/sections/trips/planner/TripMap';
import { TripNotFound } from 'src/sections/trips/TripNotFound';
import { TripTitleHeading } from 'src/sections/trips/planner/TripTitleHeading';
import { useDayPlan, type DayPlan } from 'src/sections/trips/planner/use-day-plan';
import { libraryAtom } from 'src/stores/library-state';
import { mapCardAtom, selectedDayAtom } from 'src/stores/trip-planner';

/** 이 폭(px) 이상이면 후보 칸을 펼친 채 시작한다. */
const CANDIDATES_OPEN_MIN = 1100;
const OFFLINE_NOTICE = '인터넷에 연결되지 않아 이동 시간은 어림값이에요';

/** 지도 칸 왼쪽 위에 덮는 버튼(후보 칸 펼치기·오늘 일정)의 높이와 바깥 여백(px). */
const OVERLAY_BUTTON_PX = 44;
const OVERLAY_GAP = 8;

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

/**
 * 지금 보는 Day. 기간이 줄어 없는 Day를 가리키면 마지막 Day로 보고, 그 값을 저장해 둔다.
 * 저장하지 않으면 기간을 다시 늘렸을 때 예전의 먼 Day로 갑자기 넘어간다.
 */
function useSelectedDay(trip: Trip): [number, (dayIndex: number) => void] {
  const [selected, setSelected] = useAtom(selectedDayAtom);
  const raw = selected[trip.id] ?? 0;
  const dayIndex = Math.min(Math.max(0, raw), trip.days.length - 1);
  useEffect(() => {
    if (selected[trip.id] !== undefined && selected[trip.id] !== dayIndex) {
      setSelected((prev) => ({ ...prev, [trip.id]: dayIndex }));
    }
  }, [selected, trip.id, dayIndex, setSelected]);
  const select = (next: number) => setSelected((prev) => ({ ...prev, [trip.id]: next }));
  return [dayIndex, select];
}

/** 살아 있는 장소가 여행의 후보·Stop·출발지·숙소 중 하나인가. */
function isInTrip(library: Library, trip: Trip, placeId: string): boolean {
  const place = library.places[placeId];
  if (place === undefined || place.deletedAt !== null) return false;
  return (
    locatePlace(trip, placeId) !== null ||
    trip.origin.value === placeId ||
    trip.days.some((day) => day.lodging.value === placeId)
  );
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

/**
 * 계획 화면 위에 한 번 보이는 오프라인 안내(스펙 §6). 지도 칸 위쪽 가운데에 덮는다.
 * 왼쪽 위에 `오늘 일정` 버튼이 있으면(`belowButtons`) 그 줄 아래로 내려 겹치지 않게 한다(스펙 §3.2).
 */
function OfflineNotice({
  rightInset,
  belowButtons,
}: {
  rightInset: number;
  belowButtons: boolean;
}) {
  // 중간 폭에서는 시간표 칸이 지도 오른쪽(`rightInset`)을 덮으므로 보이는 부분의 가운데에 둔다.
  return (
    <Box
      role="status"
      sx={{
        position: 'absolute',
        top: belowButtons ? OVERLAY_GAP * 2 + OVERLAY_BUTTON_PX : OVERLAY_GAP,
        left: `calc((100% - ${rightInset}px) / 2)`,
        transform: 'translateX(-50%)',
        zIndex: 1,
        width: 'max-content',
        maxWidth: `calc(100% - ${rightInset}px - 120px)`,
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

/**
 * 지도 칸 왼쪽 위의 `오늘 일정`(스펙 §3.2): 당일 모드로 간다. 후보 칸 펼치기 버튼이 있으면(`afterExpand`) 그 오른쪽.
 */
function TodayLink({ tripId, afterExpand }: { tripId: string; afterExpand: boolean }) {
  return (
    <Button
      component={Link}
      to={paths.tripToday(tripId)}
      startIcon={<NavigationIcon aria-hidden="true" width={18} height={18} />}
      sx={{
        position: 'absolute',
        top: OVERLAY_GAP,
        left: afterExpand ? OVERLAY_GAP * 2 + OVERLAY_BUTTON_PX : OVERLAY_GAP,
        zIndex: 1,
        height: OVERLAY_BUTTON_PX,
        px: 1.5,
        fontWeight: 700,
        bgcolor: 'var(--tm-bg-surface)',
        boxShadow: 'var(--tm-shadow-2)',
        '&:hover': { bgcolor: 'var(--tm-bg-raised)' },
      }}
    >
      오늘 일정
    </Button>
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
        <PlaceDetail placeId={placeId} headingLevel={2} />
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
  // 후보 칸은 1100px 미만이면 접힌 채 시작한다(시간표 칸 옆에서 지도가 너무 좁아진다). 사용자가 펼치거나 접으면
  // (`candidatesOverride`) 그 상태를 지키고, 화면을 다시 열면 기본값으로 돌아간다.
  const roomy = useMediaQuery(`(min-width:${CANDIDATES_OPEN_MIN}px)`, { noSsr: true });
  const [candidatesOverride, setCandidatesOverride] = useState<boolean | null>(null);
  const candidatesOpen = candidatesOverride ?? roomy;
  // 접기·펼치기 버튼은 누르면 사라지고 맞은편 버튼이 나타난다. 포커스가 본문(body)으로 빠지지 않게
  // 누른 쪽을 적어 두었다가 칸이 바뀐 뒤 맞은편 버튼으로 옮긴다(폭이 바뀌어 칸이 달라진 경우는 건드리지 않는다).
  const expandButton = useRef<HTMLButtonElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  const focusAfterToggle = useRef<'expand' | 'collapse' | null>(null);
  const toggleCandidates = (open: boolean) => {
    focusAfterToggle.current = open ? 'collapse' : 'expand';
    setCandidatesOverride(open);
  };
  useEffect(() => {
    const target = focusAfterToggle.current;
    if (target === null) return;
    focusAfterToggle.current = null;
    (target === 'expand' ? expandButton : collapseButton).current?.focus();
  }, [candidatesOpen]);
  const [detailId, setDetailId] = useState<string | null>(null);
  // 고른 Day의 구간·시각은 여기서 한 번 구해 지도·시간표·오프라인 안내가 함께 쓴다. 좁은 화면에서 시트가
  // 후보 탭이어도 경로 요청이 지도와 함께 시작된다.
  const plan = useDayPlan(trip.id, dayIndex);
  const [card, setCard] = useAtom(mapCardAtom);
  const cardId = card !== null && card.tripId === trip.id ? card.placeId : null;
  // 카드의 장소가 지워졌거나 여행에서 빠졌으면(다른 탭·되돌리기 등) 카드를 닫는다.
  const cardGone = cardId !== null && !isInTrip(library, trip, cardId);
  const cardPlaceId = cardGone ? null : cardId;
  const openCard = useCallback(
    (placeId: string) => setCard({ tripId: trip.id, placeId }),
    [setCard, trip.id],
  );
  const closeCard = useCallback(() => setCard(null), [setCard]);
  useEffect(() => {
    if (cardGone) setCard(null);
  }, [cardGone, setCard]);
  // 화면을 떠나면 카드를 닫는다(다시 들어왔을 때 옛 카드가 떠 있지 않게).
  useEffect(() => () => setCard(null), [setCard]);
  useHiddenPlaceToast(library, trip);
  useCloseStaleSplit(trip);
  const splitPlan = useSplitPlan(trip);

  const compact = layout === 'compact';
  const medium = layout === 'medium';
  const showCandidates = !medium || candidatesOpen;
  // 오늘(04:00 경계)이 기간 안일 때만 당일 모드로 가는 버튼을 둔다.
  const during = todayStatus(trip, new Date()).kind === 'during';
  const expandShown = !compact && !showCandidates;
  const mapArea = (padding: MapPadding, extra?: ReactNode) => (
    <MapArea>
      <TripMap
        trip={trip}
        dayIndex={dayIndex}
        legs={plan.legs}
        padding={padding}
        cardPlaceId={cardPlaceId}
        onOpenCard={openCard}
        splitPlan={splitPlan}
      />
      {plan.offline && (
        <OfflineNotice rightInset={medium ? DETAIL_WIDTH : 0} belowButtons={during} />
      )}
      {extra}
      {during && <TodayLink tripId={trip.id} afterExpand={expandShown} />}
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

  return (
    <Box sx={{ height: '100%', display: 'flex', position: 'relative', overflow: 'hidden' }}>
      {/* 후보 칸을 접으면 보이는 여행 제목이 없다. 화면 `h1`을 눈에만 숨겨 남긴다. */}
      <TripTitleHeading title={trip.title.value} candidatesShown={showCandidates} />
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
            onCollapse={medium ? () => toggleCandidates(false) : undefined}
            collapseRef={collapseButton}
          />
        </Box>
      )}
      {mapArea(
        medium ? MEDIUM_PADDING : WIDE_PADDING,
        !showCandidates && (
          <IconButton
            ref={expandButton}
            aria-label="후보 칸 펼치기"
            onClick={() => toggleCandidates(true)}
            sx={{
              position: 'absolute',
              top: OVERLAY_GAP,
              left: OVERLAY_GAP,
              zIndex: 1,
              width: OVERLAY_BUTTON_PX,
              height: OVERLAY_BUTTON_PX,
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
 * 후보 행·시간표 행은 끌어 옮길 수 있다(`PlannerDnd`가 화면 전체를 감싼다).
 */
export function TripPlannerPage() {
  const { id = '' } = useParams();
  const library = useAtomValue(libraryAtom);
  const trip = library.trips[id];
  const found = trip !== undefined && trip.deletedAt === null;
  useDocumentTitle(found ? trip.title.value : null);
  if (!found) return <TripNotFound />;
  // 여행이 바뀌면 화면 상태(후보 칸 접기·토스트 확인·끌기)를 새로 시작한다.
  return (
    <PlannerDnd key={trip.id} tripId={trip.id}>
      <Planner trip={trip} library={library} />
    </PlannerDnd>
  );
}
