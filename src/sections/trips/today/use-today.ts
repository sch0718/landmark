import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { visitedOnOf } from 'src/domain/library/visit';
import { dayEndpoints, tripDates, visibleStops } from 'src/domain/trips/query';
import type { PointTime } from 'src/domain/trips/schedule';
import {
  dayClockMin,
  isNear,
  LATE_MIN,
  pickNext,
  projectFromNow,
  todayStatus,
  usableFix,
  visitedInTrip,
  type TodayStatus,
} from 'src/domain/trips/today';
import type { Place } from 'src/schema/library';
import type { Stop, Trip } from 'src/schema/trip';
import type { GeoFix } from 'src/services/geolocation';
import { useDayPlan, type DayPlan } from 'src/sections/trips/planner/use-day-plan';
import { legInto } from 'src/sections/trips/today/today-directions';
import { useNow } from 'src/sections/trips/today/use-now';
import { libraryAtom } from 'src/stores/library-state';

/** 그날 보이는 Stop 하나. `number`는 보이는 Stop 순서의 번호(지도 핀 번호와 같다). */
export type TodayStop = {
  stop: Stop;
  place: Place;
  number: number;
  /** 이 여행 기간 안에 다녀옴으로 표시됐는가(스펙 §4.4). */
  visited: boolean;
  /** 마지막으로 다녀온 Stop보다 앞에 있는 미체크 Stop(건너뛴 곳, 스펙 §4.5). */
  skipped: boolean;
  /** 계획 시각(`useDayPlan`의 시간표). */
  planned: PointTime;
  /** 지금 나서면 예상 시각. 늦어짐을 계산할 때만 있다. */
  projected: PointTime | null;
};

/** 다음 장소: 그날의 Stop(자리) · 모두 다녀와 숙소 · 없음. */
export type TodayNext = { kind: 'stop'; index: number } | { kind: 'end'; place: Place } | null;

export type TodayModel = {
  status: TodayStatus;
  /** 오늘 Day(기간 안일 때만). */
  todayIndex: number | null;
  /** 보이는 Day. */
  dayIndex: number;
  /** 보이는 Day가 오늘 Day인가. */
  isToday: boolean;
  /**
   * 체크에 쓰는 날짜(스펙 §4.1의 오늘, 새벽 경계 반영). 기간 밖에는 체크하지 않으므로 보이는 Day의 날짜를 둔다.
   */
  date: string;
  /** 다녀옴 체크를 그리는가(기간 안이면 다른 Day에서도). */
  canCheck: boolean;
  plan: DayPlan;
  stops: TodayStop[];
  start: Place | null;
  end: Place | null;
  next: TodayNext;
  /** 마지막 체크 뒤에 미체크가 없어 앞쪽으로 되감았는가. */
  wrapped: boolean;
  /** 쓸 수 있는 내 위치(받은 지 2분 이내, 스펙 §4.7). 없으면 null. */
  fix: GeoFix | null;
  /** 다음 장소가 Stop이고 쓸 수 있는 내 위치가 그 근처인가(지금 여기, 스펙 §4.7). */
  here: boolean;
  /** 다음 장소의 예상 도착 − 계획 도착(분). 계산하지 않으면 null. */
  delayMin: number | null;
  /** 다음 장소로 가는 구간이 어림값인가. */
  approximate: boolean;
};

/** 늦어짐을 계산했고 다음 장소의 예상 도착이 계획보다 `LATE_MIN`분 이상 늦은가(스펙 §4.6). */
export const isLate = (model: Pick<TodayModel, 'delayMin'>): boolean =>
  model.delayMin !== null && model.delayMin >= LATE_MIN;

/** 시간표가 문서와 잠깐 어긋날 때(같은 렌더 안에서는 생기지 않는다) 쓰는 빈 시각. */
const NO_TIME: PointTime = { arriveMin: 0, departMin: 0, slackMin: null };

/** `viewDay`가 null이면 기간 안은 오늘 Day, 시작 전은 Day 1, 끝난 뒤는 마지막 Day. 범위 밖이면 가장 가까운 Day. */
function shownDay(trip: Trip, status: TodayStatus, viewDay: number | null): number {
  const last = trip.days.length - 1;
  const wanted =
    viewDay ?? (status.kind === 'during' ? status.dayIndex : status.kind === 'before' ? 0 : last);
  return Math.min(Math.max(0, wanted), last);
}

/**
 * 당일 모드 화면 모델(스펙 §4). 지금 시각(`useNow`)으로 오늘 Day를 고르고, 보이는 Day의 계획(`useDayPlan`)·다녀옴·
 * 다음 장소를 모은다. 보관함에서 지운 장소는 `visibleStops`가 빼므로 목록·다음 장소에서 사라진다.
 * `fix`는 받은 마지막 내 위치다. 받은 지 2분이 지나면 쓰지 않는다(`usableFix`, 시각은 `useNow`의 틱으로 다시 본다).
 */
export function useToday(
  trip: Trip,
  viewDay: number | null,
  fix: GeoFix | null = null,
): TodayModel {
  const library = useAtomValue(libraryAtom);
  const now = useNow();
  const status = useMemo(() => todayStatus(trip, now), [trip, now]);
  const dayIndex = shownDay(trip, status, viewDay);
  const plan = useDayPlan(trip.id, dayIndex);

  return useMemo(() => {
    const day = trip.days[dayIndex];
    const { start, end } = dayEndpoints(library, trip, dayIndex);
    const offset = start === null ? 0 : 1;
    const shown = day === undefined ? [] : visibleStops(library, day);
    const visited = shown.map((stop) =>
      visitedInTrip(visitedOnOf(library.places[stop.placeId]!), trip),
    );
    const pick = pickNext(visited);
    const todayIndex = status.kind === 'during' ? status.dayIndex : null;
    const isToday = todayIndex === dayIndex;
    const nextIndex = pick.nextIndex;
    const base = shown.map((stop, i): TodayStop => ({
      stop,
      place: library.places[stop.placeId]!,
      number: i + 1,
      visited: visited[i]!,
      skipped: pick.skipped.has(i),
      planned: plan.schedule.points[offset + i] ?? NO_TIME,
      projected: null,
    }));
    const me = usableFix(fix, now.getTime());
    const nextPlace = nextIndex === null ? undefined : base[nextIndex]?.place;
    const here = me !== null && nextPlace !== undefined && isNear(me, nextPlace);

    // 늦어짐(스펙 §4.6): 오늘 Day를 보고, 다음 장소가 Stop이고, 되감음이 아닐 때만. 계획과 같은 입력(`plan.input`)으로
    // "지금 나서면"을 다시 계산해 다음 장소부터 끝까지 예상 시각을 붙인다. 지금 여기면 도착 = max(지금, 계획 도착).
    let projected: PointTime[] = [];
    let delayMin: number | null = null;
    let approximate = false;
    if (isToday && status.kind === 'during' && nextIndex !== null && !pick.wrapped) {
      const projection = projectFromNow({
        input: plan.input,
        planned: plan.schedule,
        nextIndex,
        nowMin: dayClockMin(status.date, now),
        here,
      });
      if (projection.points.length > 0) {
        projected = projection.points;
        delayMin = projection.delayMin;
        // 앞 지점에서 다음 장소로 들어오는 구간이 어림값이면 예상 앞에 `약`. 지금 여기면 그 구간을 쓰지 않는다.
        approximate =
          !here && (legInto({ start, end, stops: base, plan }, nextIndex)?.time.estimated ?? false);
      }
    }

    const stops =
      nextIndex === null
        ? base
        : base.map((item, i) =>
            i >= nextIndex ? { ...item, projected: projected[i - nextIndex] ?? null } : item,
          );
    let next: TodayNext = null;
    if (nextIndex !== null) next = { kind: 'stop', index: nextIndex };
    else if (stops.length > 0 && end !== null) next = { kind: 'end', place: end };
    return {
      status,
      todayIndex,
      dayIndex,
      isToday,
      date: status.kind === 'during' ? status.date : (tripDates(trip)[dayIndex] ?? ''),
      canCheck: status.kind === 'during',
      plan,
      stops,
      start,
      end,
      next,
      wrapped: pick.wrapped,
      fix: me,
      here,
      delayMin,
      approximate,
    };
  }, [library, trip, dayIndex, plan, status, now, fix]);
}
