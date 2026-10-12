import { Schema } from 'effect';
import { CalendarDate, HHmm, IsoDateTime } from 'src/schema/common';
import { FieldSchema, LIBRARY_LIMITS, PlaceId } from 'src/schema/library-base';

// 옛 PoC의 `StopId`(common.ts, 4자 이상)와 다르다. 여행 계획 전용으로 8자 고정.
export const TripId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]{10}$/, { message: 'TripId는 영숫자 소문자 10자입니다' }),
);
export const TripStopId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]{8}$/, { message: 'TripStopId는 영숫자 소문자 8자입니다' }),
);

export const StopSchema = Schema.Struct({
  id: TripStopId,
  placeId: PlaceId,
  /** 머무는 시간(분). `null`이면 기본값을 쓴다. */
  stayMin: Schema.NullOr(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isBetween({ minimum: 0, maximum: LIBRARY_LIMITS.stayMaxMin }),
    ),
  ),
  fixedTime: Schema.NullOr(HHmm),
  note: Schema.String.check(Schema.isMaxLength(LIBRARY_LIMITS.stopNoteChars)),
});

export const DaySchema = Schema.Struct({
  stops: FieldSchema(Schema.Array(StopSchema)),
  /** 그날 밤 숙소(마지막 날은 도착지). */
  lodging: FieldSchema(Schema.NullOr(PlaceId)),
  startTime: FieldSchema(HHmm),
});

export const TripSchema = Schema.Struct({
  id: TripId,
  title: FieldSchema(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(LIBRARY_LIMITS.tripTitleChars)),
  ),
  startDate: FieldSchema(CalendarDate),
  endDate: FieldSchema(CalendarDate),
  /** 1일차 출발지. */
  origin: FieldSchema(Schema.NullOr(PlaceId)),
  /** 후보(순서 있음). */
  candidates: FieldSchema(Schema.Array(PlaceId)),
  days: Schema.Array(DaySchema),
  // 키 형식("<출발 PlaceId>><도착 PlaceId>")은 `checkTrip`이 검사한다.
  // 키에 패턴을 걸면 Effect가 틀린 항목을 오류 없이 버리기 때문이다(library.ts 참고).
  legModes: FieldSchema(Schema.Record(Schema.String, Schema.Literals(['car', 'walk']))),
  createdAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});

export type Stop = typeof StopSchema.Type;
export type Day = typeof DaySchema.Type;
export type Trip = typeof TripSchema.Type;

const DAY_MS = 86_400_000;
const LEG_KEY = /^[a-z0-9]{10}>[a-z0-9]{10}$/;

/** `start`~`end`의 날 수. 양 끝을 포함하므로 같은 날이면 1. UTC 자정 기준이라 시간대·서머타임에 흔들리지 않는다. */
export function daysBetween(start: string, end: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((toUtc(end) - toUtc(start)) / DAY_MS) + 1;
}

/**
 * 한 여행의 관계 검증. 필드 하나로는 알 수 없는 규칙만 모았다.
 * `places`에는 묘비(`deletedAt`)인 장소도 들어 있어야 한다. 묘비 참조는 허용한다.
 * `path`는 이 여행의 위치(예: `['trips', id]`)이고, 이슈 경로는 이 아래로 붙는다.
 */
export function checkTrip(
  trip: Trip,
  places: Readonly<Record<string, unknown>>,
  path: PropertyKey[],
): Schema.FilterIssue[] {
  const issues: Schema.FilterIssue[] = [];
  const add = (sub: PropertyKey[], issue: string) =>
    issues.push({ path: [...path, ...sub], issue });

  const span = daysBetween(trip.startDate.value, trip.endDate.value);
  if (span < 1) {
    add(['endDate'], '시작일이 종료일보다 늦습니다');
  } else if (span > LIBRARY_LIMITS.tripMaxDays) {
    add(['endDate'], `여행은 ${LIBRARY_LIMITS.tripMaxDays}일까지입니다`);
  } else if (trip.days.length !== span) {
    add(['days'], 'Day 수가 기간과 다릅니다');
  }

  const known = (placeId: string) => Object.hasOwn(places, placeId);
  const checkKnown = (sub: PropertyKey[], placeId: string) => {
    if (!known(placeId)) add(sub, `없는 장소입니다: ${placeId}`);
  };

  // 후보와 모든 Day의 Stop을 통틀어 장소는 한 번만. `origin`·`lodging`은 이 규칙 밖이다.
  const placed = new Set<string>();
  const place = (sub: PropertyKey[], placeId: string) => {
    if (placed.has(placeId)) add(sub, `여행 안에서 장소가 중복됩니다: ${placeId}`);
    placed.add(placeId);
    checkKnown(sub, placeId);
  };

  if (trip.origin.value !== null) checkKnown(['origin'], trip.origin.value);
  trip.candidates.value.forEach((placeId, i) => place(['candidates', i], placeId));

  const seenStop = new Set<string>();
  trip.days.forEach((day, di) => {
    if (day.lodging.value !== null) checkKnown(['days', di, 'lodging'], day.lodging.value);
    day.stops.value.forEach((stop, si) => {
      const at = ['days', di, 'stops', si];
      if (seenStop.has(stop.id)) add(at, `Stop id가 중복됩니다: ${stop.id}`);
      seenStop.add(stop.id);
      place(at, stop.placeId);
    });
  });

  for (const key of Object.keys(trip.legModes.value)) {
    if (!LEG_KEY.test(key)) add(['legModes', key], `구간 키가 올바르지 않습니다: ${key}`);
  }
  return issues;
}
