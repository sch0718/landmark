import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import { useAtomValue, useSetAtom } from 'jotai';
import { Fragment, useState } from 'react';
import { LockIcon } from 'src/components/icons';
import { checkVisit, visitOf } from 'src/domain/trips/hours';
import { setDayStartTime, setLegMode } from 'src/domain/trips/ops';
import { dayEndpoints, tripDates, visibleStops } from 'src/domain/trips/query';
import { formatClock, formatSlack, formatSpan, type PointTime } from 'src/domain/trips/schedule';
import type { Place } from 'src/schema/library';
import type { Stop, Trip } from 'src/schema/trip';
import { TripShareDialogHost } from 'src/sections/share-export/TripShareDialogHost';
import { DayHeader } from 'src/sections/trips/planner/DayHeader';
import { DayTail } from 'src/sections/trips/planner/DayTail';
import { HoursNotice, noticeFor } from 'src/sections/trips/planner/HoursNotice';
import { LegRow } from 'src/sections/trips/planner/LegRow';
import { useOptimizeDay } from 'src/sections/trips/planner/optimize-ops';
import {
  DragHandle,
  DropTab,
  useDropTarget,
  useStopDrag,
} from 'src/sections/trips/planner/PlannerDnd';
import { lodgingMessage, lodgingOp } from 'src/sections/trips/planner/stop-ops';
import { StopMenu } from 'src/sections/trips/planner/StopMenu';
import { TripSettingsDialog } from 'src/sections/trips/planner/TripSettingsDialog';
import {
  isSamePointLeg,
  type DayPlan,
  type PlannedLeg,
} from 'src/sections/trips/planner/use-day-plan';
import { usePlaceHours } from 'src/sections/trips/planner/use-place-hours';
import { useTripUndo } from 'src/sections/trips/planner/use-trip-undo';
import { shortDate } from 'src/sections/trips/trip-dates';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';
import { mapCardAtom } from 'src/stores/trip-planner';

/** Day 탭: `Day 1 10.24(금)` …. 행을 끌어 탭에 놓으면 그 Day 끝으로 옮긴다. */
export function DayTabs({
  trip,
  dayIndex,
  onSelect,
}: {
  trip: Trip;
  dayIndex: number;
  onSelect(dayIndex: number): void;
}) {
  const dates = tripDates(trip);
  return (
    <Tabs
      value={dayIndex}
      onChange={(_event, value: number) => onSelect(value)}
      variant="scrollable"
      scrollButtons={false}
      aria-label="Day 고르기"
      sx={{ flex: 'none', borderBottom: '1px solid var(--tm-border)' }}
    >
      {trip.days.map((_, i) => (
        <DropTab
          key={i}
          dropId={`tab:${i}`}
          target={{ kind: 'day', dayIndex: i }}
          value={i}
          label={
            <span>
              <Box component="span" sx={{ fontWeight: 800 }}>{`Day ${i + 1}`}</Box>{' '}
              <Box component="span" sx={{ fontSize: 12 }}>
                {dates[i] === undefined ? '' : shortDate(dates[i])}
              </Box>
            </span>
          }
          sx={{ minHeight: 48, textTransform: 'none' }}
        />
      ))}
    </Tabs>
  );
}

/** 끌기로 놓을 자리 표시(행 위·아래의 선). */
const markerSx = (marker: 'before' | 'after' | null) =>
  marker === null
    ? {}
    : { boxShadow: `inset 0 ${marker === 'before' ? 2 : -2}px 0 var(--tm-accent-main)` };

function StopRow({
  trip,
  dayIndex,
  date,
  number,
  stop,
  place,
  point,
  prevStopId,
  nextStopId,
  onOpen,
}: {
  trip: Trip;
  dayIndex: number;
  /** 그 Day의 날짜('YYYY-MM-DD'). 영업시간 판정에 쓴다. */
  date: string;
  number: number;
  stop: Stop;
  place: Place;
  point: PointTime | undefined;
  /** 바로 위·아래에 보이는 행(행 메뉴의 `위로`·`아래로`). */
  prevStopId: string | null;
  nextStopId: string | null;
  /** 행을 누르면 지도 위 카드를 연다. */
  onOpen(): void;
}) {
  const late = point?.slackMin !== null && point?.slackMin !== undefined && point.slackMin < 0;
  const name = place.name.value;
  // 요청은 계획 화면이 여행 단위로 한 번 한다(`useTripHoursRequests`). 행은 상태만 읽는다.
  const { view } = usePlaceHours(place);
  const notice =
    point === undefined
      ? null
      : noticeFor(view, (hours) => checkVisit(hours, date, visitOf(point, stop)));
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging, marker } =
    useStopDrag({ kind: 'stop', stopId: stop.id, placeId: stop.placeId, dayIndex, name });
  return (
    <Box
      component="li"
      ref={setNodeRef}
      sx={{
        listStyle: 'none',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 0.5,
        pr: 0,
        py: 1,
        minHeight: 44,
        opacity: isDragging ? 0.4 : 1,
        ...markerSx(marker),
      }}
    >
      <DragHandle
        name={name}
        setActivatorNodeRef={setActivatorNodeRef}
        attributes={attributes}
        listeners={listeners}
      />
      <Box
        aria-hidden="true"
        sx={{
          mt: 0.5,
          flex: 'none',
          width: 28,
          height: 28,
          display: 'grid',
          placeItems: 'center',
          borderRadius: '50%',
          bgcolor: 'var(--tm-accent-main)',
          color: 'var(--tm-accent-contrast)',
          fontSize: 13,
          fontWeight: 800,
        }}
      >
        {number}
      </Box>
      <Box
        component="button"
        type="button"
        onClick={onOpen}
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 44,
          display: 'block',
          p: 0,
          border: 0,
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
          borderRadius: 'var(--tm-radius-sm)',
        }}
      >
        <Box component="span" sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
          {point !== undefined && (
            <Box
              component="span"
              sx={{ flex: 'none', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}
            >
              {formatClock(point.arriveMin)}
            </Box>
          )}
          <Box component="span" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
            {name}
          </Box>
        </Box>
        <Box
          component="span"
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: 1,
            fontSize: 12,
            color: 'var(--tm-text-secondary)',
          }}
        >
          {stop.stayMin !== null && <span>{`체류 ${formatSpan(stop.stayMin)}`}</span>}
          {stop.fixedTime !== null && (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
              <LockIcon aria-hidden="true" width={12} height={12} />
              <span>{`${stop.fixedTime} 고정`}</span>
              {point?.slackMin !== null && point?.slackMin !== undefined && (
                <Box
                  component="span"
                  sx={{ color: late ? 'error.main' : 'inherit', fontWeight: late ? 700 : 400 }}
                >
                  {formatSlack(point.slackMin)}
                </Box>
              )}
            </Box>
          )}
        </Box>
        {notice !== null && <HoursNotice notice={notice} />}
      </Box>
      <StopMenu
        trip={trip}
        dayIndex={dayIndex}
        name={name}
        stopId={stop.id}
        prevStopId={prevStopId}
        nextStopId={nextStopId}
      />
    </Box>
  );
}

/**
 * Day 시간표 몸통(스펙 §2.3): 머리(출발 시각·출발점, `순서 정리`, `여행 설정`, `일정 공유`), 장소 행과 구간 행, 꼬리(숙소·합계).
 * 같은 지점 구간(직선 10m 미만)은 계산에는 넣되(0분) 행은 보이지 않는다. 장소 행을 누르면 지도 위 카드를 연다.
 * 구간·시각(`plan`)은 계획 화면이 한 번 구해 지도와 함께 쓴다. 오프라인 안내도 계획 화면이 한 번 보인다.
 */
export function DayTimeline({
  trip,
  dayIndex,
  plan,
}: {
  trip: Trip;
  dayIndex: number;
  plan: DayPlan;
}) {
  const library = useAtomValue(libraryAtom);
  const { run } = useLibraryAction();
  // 숙소 정하기·빼기는 되돌리기 토스트를 띄운다.
  const { run: runUndoable } = useTripUndo(trip.id);
  const openCard = useSetAtom(mapCardAtom);
  const day = trip.days[dayIndex]!;
  const { start, end } = dayEndpoints(library, trip, dayIndex);
  const stops = visibleStops(library, day);
  const optimize = useOptimizeDay(trip.id, dayIndex);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const { points, totals } = plan.schedule;
  const offset = start === null ? 0 : 1;
  const legs = plan.legs;
  const date = tripDates(trip)[dayIndex] ?? '';
  // 시간표 목록의 빈 곳(구간 행 사이·장소 없는 Day)에 놓으면 가장 가까운 행 또는 그 Day 끝.
  const { setNodeRef: setListRef } = useDropTarget(`list:${dayIndex}`, {
    kind: 'day-end',
    dayIndex,
  });

  const legRow = (leg: PlannedLeg | undefined) => {
    if (leg === undefined || isSamePointLeg(leg)) return null;
    return (
      <LegRow
        leg={leg}
        onMode={(mode) =>
          void run((lib, ctx) => setLegMode(lib, trip.id, leg.from.id, leg.to.id, mode, ctx))
        }
        onRetry={() => plan.retryLeg(leg.key)}
      />
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <DayHeader
        key={`${trip.id}/${dayIndex}`}
        dayIndex={dayIndex}
        startTime={day.startTime.value}
        start={start}
        onStartTime={(value) =>
          void run((lib, ctx) => setDayStartTime(lib, trip.id, dayIndex, value, ctx))
        }
        canOptimize={stops.length >= 2}
        onOptimize={() => void optimize()}
        onSettings={() => setSettingsOpen(true)}
        onShare={() => setShareOpen(true)}
      />
      <TripSettingsDialog trip={trip} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <TripShareDialogHost open={shareOpen} onClose={() => setShareOpen(false)} tripId={trip.id} />
      <Box
        component="ol"
        ref={setListRef}
        aria-label={`Day ${dayIndex + 1} 일정`}
        sx={{ m: 0, px: 0.5, py: 1 }}
      >
        <SortableContext
          items={stops.map((s) => `stop:${s.id}`)}
          strategy={verticalListSortingStrategy}
        >
          {stops.map((stop, i) => (
            <Fragment key={stop.id}>
              {offset + i > 0 && legRow(legs[offset + i - 1])}
              <StopRow
                trip={trip}
                dayIndex={dayIndex}
                date={date}
                number={i + 1}
                stop={stop}
                place={library.places[stop.placeId]!}
                point={points[offset + i]}
                prevStopId={stops[i - 1]?.id ?? null}
                nextStopId={stops[i + 1]?.id ?? null}
                onOpen={() => openCard({ tripId: trip.id, placeId: stop.placeId })}
              />
            </Fragment>
          ))}
        </SortableContext>
        {stops.length === 0 && (
          <Box
            component="li"
            sx={{ listStyle: 'none', py: 3, textAlign: 'center', color: 'var(--tm-text-muted)' }}
          >
            장소를 넣어 보세요
          </Box>
        )}
        {end !== null && legRow(legs.at(-1))}
      </Box>
      <DayTail
        tripId={trip.id}
        isLastDay={dayIndex === trip.days.length - 1}
        lodging={end}
        lodgingArriveMin={end === null ? null : (points.at(-1)?.arriveMin ?? null)}
        hasLegs={legs.some((leg) => !isSamePointLeg(leg))}
        totals={totals}
        oldestQueriedAt={plan.oldestQueriedAt}
        onLodging={(placeId, alsoFollowing) =>
          void runUndoable(
            lodgingOp(trip.id, dayIndex, placeId, alsoFollowing),
            lodgingMessage(placeId),
          )
        }
        onRefresh={plan.refresh}
      />
    </Box>
  );
}
