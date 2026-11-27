import { Schema } from 'effect';
import { daysBetween } from 'src/lib/calendar';
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

/** 구간에 직접 입력하는 시간(분). */
export const LegMinutes = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 1440 }),
);

// 준비 필드 한도(기획서 §4.1). 첫 화면 JS에 들어가므로 `LIBRARY_LIMITS` 키 대신 묶지 않은 상수로 둔다.
export const PREP_FIELD_CHARS = { bookings: 50_000, prepNotes: 30_000, phrases: 30_000 } as const;
export const BOOKINGS_MAX = 60;
export const PREP_NOTES_MAX = 40;
export const PHRASES_MAX = 150;
export const BOOKING_TITLE_CHARS = 80;
export const BOOKING_LINKS_MAX = 3;
export const BOOKING_LINK_LABEL_CHARS = 30;
export const PREP_URL_CHARS = 500;
export const BOOKING_CODE_CHARS = 60;
export const BOOKING_VIA_CHARS = 40;
export const BOOKING_NOTE_CHARS = 300;
export const PREP_REGION_CHARS = 30;
export const PREP_TEXT_CHARS = 1500;
export const PREP_SOURCES_MAX = 3;
export const PHRASE_KO_CHARS = 200;
export const PHRASE_TEXT_CHARS = 500;
export const PHRASE_READING_CHARS = 300;
export const PHRASE_NOTE_CHARS = 200;

const max = (n: number) => Schema.String.check(Schema.isMaxLength(n));
const text = (n: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(n));
const PrepId = Schema.String.check(Schema.isPattern(/^[a-z0-9]{8}$/));
const isCalendarDate = Schema.is(CalendarDate);
const isHHmm = Schema.is(HHmm);
/** 시간대 없는 현지 일시 `YYYY-MM-DDTHH:mm`. */
const LocalDateTime = Schema.String.check(
  Schema.makeFilter((value) => {
    const parts = value.split('T');
    return parts.length === 2 && isCalendarDate(parts[0]) && isHHmm(parts[1]);
  }),
);
const HttpsUrl = max(PREP_URL_CHARS).check(
  Schema.makeFilter((value) => {
    try {
      return value.startsWith('https://') && new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }),
);

export const BookingSchema = Schema.Struct({
  id: PrepId,
  kind: Schema.Literals([
    'flight',
    'train',
    'bus',
    'lodging',
    'ticket',
    'restaurant',
    'tour',
    'car',
    'insurance',
    'other',
  ]),
  title: text(BOOKING_TITLE_CHARS),
  need: Schema.Literals(['required', 'recommended', 'optional']),
  status: Schema.Literals(['todo', 'booked', 'pending', 'skipped']),
  date: Schema.NullOr(CalendarDate),
  placeId: Schema.NullOr(PlaceId),
  links: Schema.Array(Schema.Struct({ label: max(BOOKING_LINK_LABEL_CHARS), url: HttpsUrl })).check(
    Schema.isMaxLength(BOOKING_LINKS_MAX),
  ),
  bookBy: Schema.NullOr(CalendarDate),
  at: Schema.NullOr(LocalDateTime),
  freeCancelUntil: Schema.NullOr(LocalDateTime),
  code: max(BOOKING_CODE_CHARS),
  price: Schema.NullOr(
    Schema.Struct({
      amount: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
      currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
    }),
  ),
  bookedVia: max(BOOKING_VIA_CHARS),
  note: max(BOOKING_NOTE_CHARS),
});

export const PrepNoteSchema = Schema.Struct({
  id: PrepId,
  topic: Schema.Literals([
    'language',
    'money',
    'prices',
    'weather',
    'time',
    'power',
    'tips',
    'safety',
    'emergency',
    'transit',
    'docs',
    'other',
  ]),
  region: max(PREP_REGION_CHARS),
  text: text(PREP_TEXT_CHARS),
  sources: Schema.Array(HttpsUrl).check(Schema.isMaxLength(PREP_SOURCES_MAX)),
  checkedOn: Schema.NullOr(CalendarDate),
  unsure: Schema.Boolean,
});

export const PhraseSchema = Schema.Struct({
  id: PrepId,
  situation: Schema.Literals([
    'greet',
    'restaurant',
    'directions',
    'transit',
    'lodging',
    'shopping',
    'emergency',
    'other',
  ]),
  ko: text(PHRASE_KO_CHARS),
  text: text(PHRASE_TEXT_CHARS),
  /** BCP 47 태그 2~12자. */
  lang: Schema.String.check(
    Schema.isMinLength(2),
    Schema.isMaxLength(12),
    Schema.makeFilter((value) => {
      try {
        Intl.getCanonicalLocales(value);
        return true;
      } catch {
        return false;
      }
    }),
  ),
  reading: max(PHRASE_READING_CHARS),
  note: max(PHRASE_NOTE_CHARS),
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
  /** 옛 버전이 legModes를 읽을 수 있도록 대중교통은 따로 둔다. */
  legTransit: Schema.optional(FieldSchema(Schema.Array(Schema.String))),
  legMinutes: Schema.optional(FieldSchema(Schema.Record(Schema.String, LegMinutes))),
  bookings: Schema.optional(
    FieldSchema(Schema.Array(BookingSchema).check(Schema.isMaxLength(BOOKINGS_MAX))),
  ),
  prepNotes: Schema.optional(
    FieldSchema(Schema.Array(PrepNoteSchema).check(Schema.isMaxLength(PREP_NOTES_MAX))),
  ),
  phrases: Schema.optional(
    FieldSchema(Schema.Array(PhraseSchema).check(Schema.isMaxLength(PHRASES_MAX))),
  ),
  createdAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});

export type Stop = typeof StopSchema.Type;
export type Day = typeof DaySchema.Type;
export type Booking = typeof BookingSchema.Type;
export type PrepNote = typeof PrepNoteSchema.Type;
export type Phrase = typeof PhraseSchema.Type;
export type Trip = typeof TripSchema.Type;

const LEG_KEY = /^[a-z0-9]{10}>[a-z0-9]{10}$/;

export { addDays, daysBetween } from 'src/lib/calendar';

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

  trip.bookings?.value.forEach((booking, i) => {
    if (booking.placeId !== null) checkKnown(['bookings', 'value', i, 'placeId'], booking.placeId);
  });
  for (const key of ['bookings', 'prepNotes', 'phrases'] as const) {
    const values = trip[key]?.value;
    if (!values) continue;
    if (JSON.stringify(values).length > PREP_FIELD_CHARS[key]) add([key], '너무 깁니다');
    const seen = new Set<string>();
    values.forEach(({ id }, i) => {
      if (seen.has(id)) add([key, 'value', i, 'id'], `${key} id 중복: ${id}`);
      seen.add(id);
    });
  }

  for (const key of Object.keys(trip.legModes.value)) {
    if (!LEG_KEY.test(key)) add(['legModes', key], `구간 키가 올바르지 않습니다: ${key}`);
  }
  for (const key of trip.legTransit?.value ?? []) {
    if (!LEG_KEY.test(key)) add(['legTransit', key], `구간 키가 올바르지 않습니다: ${key}`);
  }
  for (const key of Object.keys(trip.legMinutes?.value ?? {})) {
    if (!LEG_KEY.test(key)) add(['legMinutes', key], `구간 키가 올바르지 않습니다: ${key}`);
  }
  return issues;
}
