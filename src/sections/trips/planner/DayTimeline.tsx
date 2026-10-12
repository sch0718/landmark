import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { useAtomValue, useSetAtom } from 'jotai';
import { Fragment } from 'react';
import { LockIcon } from 'src/components/icons';
import { setDayStartTime, setLegMode, setLodging } from 'src/domain/trips/ops';
import { dayEndpoints, tripDates, visibleStops } from 'src/domain/trips/query';
import { formatClock, formatSlack, formatSpan, type PointTime } from 'src/domain/trips/schedule';
import type { Place } from 'src/schema/library';
import type { Stop, Trip } from 'src/schema/trip';
import { DayHeader } from 'src/sections/trips/planner/DayHeader';
import { DayTail } from 'src/sections/trips/planner/DayTail';
import { LegRow } from 'src/sections/trips/planner/LegRow';
import {
  isSamePointLeg,
  type DayPlan,
  type PlannedLeg,
} from 'src/sections/trips/planner/use-day-plan';
import { shortDate } from 'src/sections/trips/trip-dates';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';
import { mapCardAtom } from 'src/stores/trip-planner';

/** Day 탭: `Day 1 10.24(금)` …. */
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
        <Tab
          key={i}
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

function StopRow({
  number,
  stop,
  place,
  point,
  onOpen,
}: {
  number: number;
  stop: Stop;
  place: Place;
  point: PointTime | undefined;
  /** 행을 누르면 지도 위 카드를 연다. */
  onOpen(): void;
}) {
  const late = point?.slackMin !== null && point?.slackMin !== undefined && point.slackMin < 0;
  return (
    <Box
      component="li"
      sx={{
        listStyle: 'none',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1,
        px: 1,
        py: 1,
        minHeight: 44,
      }}
    >
      <Box
        aria-hidden="true"
        sx={{
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
          '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: 2 },
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
            {place.name.value}
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
      </Box>
    </Box>
  );
}

/**
 * Day 시간표 몸통(스펙 §2.3): 머리(출발 시각·출발점), 장소 행과 구간 행, 꼬리(숙소·합계).
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
  const openCard = useSetAtom(mapCardAtom);
  const day = trip.days[dayIndex]!;
  const { start, end } = dayEndpoints(library, trip, dayIndex);
  const stops = visibleStops(library, day);
  const { points, totals } = plan.schedule;
  const offset = start === null ? 0 : 1;
  const legs = plan.legs;

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
      />
      <Box component="ol" aria-label={`Day ${dayIndex + 1} 일정`} sx={{ m: 0, px: 1, py: 1 }}>
        {stops.map((stop, i) => (
          <Fragment key={stop.id}>
            {offset + i > 0 && legRow(legs[offset + i - 1])}
            <StopRow
              number={i + 1}
              stop={stop}
              place={library.places[stop.placeId]!}
              point={points[offset + i]}
              onOpen={() => openCard({ tripId: trip.id, placeId: stop.placeId })}
            />
          </Fragment>
        ))}
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
          void run((lib, ctx) => setLodging(lib, trip.id, dayIndex, placeId, alsoFollowing, ctx))
        }
        onRefresh={plan.refresh}
      />
    </Box>
  );
}
