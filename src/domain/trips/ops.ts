import { setField, type Field } from 'src/domain/library/lww';
import type { OpCtx, OpResult } from 'src/domain/library/ops';
import { autoMode, haversineM, WALK_MAX_M } from 'src/domain/trips/geo';
import { legKey, locatePlace, type TripLocation } from 'src/domain/trips/query';
import { LIBRARY_LIMITS, type Library } from 'src/schema/library';
import { daysBetween, type Day, type Stop, type Trip } from 'src/schema/trip';

// 여행을 바꾸는 연산(스펙 §3.4). 보관함 연산(library/ops.ts)과 같은 규칙을 따른다 —
// 입력을 바꾸지 않는 순수 함수이고, 바뀐 필드만 `updatedAt = ctx.now`, 나머지는 같은 참조로 둔다.
// 결과 문서는 늘 `LibrarySchema`(장소 한 번만, Day 수 = 날짜 수 등)를 통과한다.

export type TripOpError =
  | { _tag: 'TripTitleInvalid'; reason: 'empty' | 'too-long' }
  | { _tag: 'TripDatesInvalid'; reason: 'order' | 'too-many-days' }
  | { _tag: 'AlreadyInTrip'; location: TripLocation }
  | { _tag: 'NotFound'; id: string }
  /** 미리보기(자동 나누기)를 만든 뒤 여행이 바뀌어 그 결과를 적용할 수 없다. */
  | { _tag: 'TripChanged'; id: string };

export {
  diffTrip,
  isEmptyChange,
  revertTrip,
  type TripChange,
  type TripFieldChange,
  type TripFieldPath,
  type TripPeriod,
} from 'src/domain/trips/undo';

const fail = (error: TripOpError): OpResult => ({ ok: false, error });
const notFound = (id: string): TripOpError => ({ _tag: 'NotFound', id });
/** 없는 Day를 가리킬 때의 NotFound id. */
const dayId = (tripId: string, dayIndex: number) => `${tripId}/days/${dayIndex}`;

const DEFAULT_START_TIME = '09:00';
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---------- 공통 ----------

const isTripError = (value: Trip | TripOpError): value is TripOpError => '_tag' in value;

function liveTrip(lib: Library, tripId: string): Trip | null {
  const trip = lib.trips[tripId];
  return trip !== undefined && trip.deletedAt === null ? trip : null;
}

/** 보관함에 있고 지워지지 않은 장소인가. 여행에 새로 들이는 장소는 이것이어야 한다. */
function isLivePlace(lib: Library, placeId: string): boolean {
  const place = lib.places[placeId];
  return place !== undefined && place.deletedAt === null;
}

function withTrip(lib: Library, before: Trip, after: Trip): Library {
  return after === before ? lib : { ...lib, trips: { ...lib.trips, [after.id]: after } };
}

/** 살아 있는 여행에 `update`를 적용한다. 바뀐 것이 없으면 같은 문서를 돌려준다. */
function updateTrip(
  lib: Library,
  tripId: string,
  update: (trip: Trip) => Trip | TripOpError,
): OpResult {
  const trip = liveTrip(lib, tripId);
  if (trip === null) return fail(notFound(tripId));
  const next = update(trip);
  if (isTripError(next)) return fail(next);
  return { ok: true, lib: withTrip(lib, trip, next) };
}

type TripFieldKey = 'title' | 'startDate' | 'endDate' | 'origin' | 'candidates' | 'legModes';

function withField<K extends TripFieldKey>(
  trip: Trip,
  key: K,
  value: Trip[K]['value'],
  now: string,
): Trip {
  const current = trip[key] as Field<Trip[K]['value']>;
  const field = setField(current, value, now);
  return field === current ? trip : ({ ...trip, [key]: field } as Trip);
}

type DayFieldKey = 'stops' | 'lodging' | 'startTime';

function withDayField<K extends DayFieldKey>(
  trip: Trip,
  dayIndex: number,
  key: K,
  value: Day[K]['value'],
  now: string,
): Trip {
  const day = trip.days[dayIndex]!;
  const current = day[key] as Field<Day[K]['value']>;
  const field = setField(current, value, now);
  if (field === current) return trip;
  const days = trip.days.slice();
  days[dayIndex] = { ...day, [key]: field } as Day;
  return { ...trip, days };
}

function newDay(now: string): Day {
  return {
    stops: { value: [], updatedAt: now },
    lodging: { value: null, updatedAt: now },
    startTime: { value: DEFAULT_START_TIME, updatedAt: now },
  };
}

const hasDay = (trip: Trip, dayIndex: number) =>
  Number.isInteger(dayIndex) && dayIndex >= 0 && dayIndex < trip.days.length;

const clamp = (n: number, min: number, max: number) =>
  Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : max;

const without = <V>(list: readonly V[], index: number): V[] => list.filter((_, i) => i !== index);

const insertAt = <V>(list: readonly V[], index: number, item: V): V[] => [
  ...list.slice(0, index),
  item,
  ...list.slice(index),
];

function findStop(
  trip: Trip,
  stopId: string,
): { dayIndex: number; stopIndex: number; stop: Stop } | null {
  for (let dayIndex = 0; dayIndex < trip.days.length; dayIndex++) {
    const stops = trip.days[dayIndex]!.stops.value;
    const stopIndex = stops.findIndex((s) => s.id === stopId);
    if (stopIndex >= 0) return { dayIndex, stopIndex, stop: stops[stopIndex]! };
  }
  return null;
}

/** 다듬은 제목. 검사는 다듬은 값 기준이다. */
function checkTitle(title: string): string | TripOpError {
  const trimmed = title.trim();
  if (trimmed.length === 0) return { _tag: 'TripTitleInvalid', reason: 'empty' };
  if (trimmed.length > LIBRARY_LIMITS.tripTitleChars) {
    return { _tag: 'TripTitleInvalid', reason: 'too-long' };
  }
  return trimmed;
}

/** 실제 달력 날짜('YYYY-MM-DD')인가. 2월 30일처럼 넘치는 날은 아니다. */
function isCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m === null) return false;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return dt.getUTCMonth() === Number(m[2]) - 1 && dt.getUTCDate() === Number(m[3]);
}

/** 기간의 날 수. 날짜가 틀렸거나 순서가 거꾸로면 'order', 30일을 넘으면 'too-many-days'. */
function checkDates(startDate: string, endDate: string): number | TripOpError {
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) {
    return { _tag: 'TripDatesInvalid', reason: 'order' };
  }
  const span = daysBetween(startDate, endDate);
  if (span < 1) return { _tag: 'TripDatesInvalid', reason: 'order' };
  if (span > LIBRARY_LIMITS.tripMaxDays) {
    return { _tag: 'TripDatesInvalid', reason: 'too-many-days' };
  }
  return span;
}

// ---------- 여행 ----------

export function createTrip(
  lib: Library,
  input: {
    title: string;
    startDate: string;
    endDate: string;
    origin: string | null;
    candidates: string[];
  },
  ctx: OpCtx,
): OpResult {
  const title = checkTitle(input.title);
  if (typeof title !== 'string') return fail(title);
  const span = checkDates(input.startDate, input.endDate);
  if (typeof span !== 'number') return fail(span);
  if (input.origin !== null && !isLivePlace(lib, input.origin)) {
    return fail(notFound(input.origin));
  }
  const at = <V>(value: V): Field<V> => ({ value, updatedAt: ctx.now });
  const id = ctx.newId('trip');
  const trip: Trip = {
    id,
    title: at(title),
    startDate: at(input.startDate),
    endDate: at(input.endDate),
    origin: at(input.origin),
    candidates: at([...new Set(input.candidates)].filter((p) => isLivePlace(lib, p))),
    days: Array.from({ length: span }, () => newDay(ctx.now)),
    legModes: at({}),
    createdAt: ctx.now,
    deletedAt: null,
  };
  return { ok: true, lib: { ...lib, trips: { ...lib.trips, [id]: trip } }, createdId: id };
}

export function renameTrip(lib: Library, tripId: string, title: string, ctx: OpCtx): OpResult {
  return updateTrip(lib, tripId, (trip) => {
    const trimmed = checkTitle(title);
    return typeof trimmed === 'string' ? withField(trip, 'title', trimmed, ctx.now) : trimmed;
  });
}

/**
 * 기간을 바꾼다. 줄면 잘린 Day의 장소를 Day·자리 순서대로 후보 끝에 두고(체류·메모는 버린다),
 * 늘면 빈 Day를 뒤에 붙인다. 날 수가 같으면(시작일만 옮김) Day 내용은 그대로다.
 */
export function setTripDates(
  lib: Library,
  tripId: string,
  startDate: string,
  endDate: string,
  ctx: OpCtx,
): OpResult {
  return updateTrip(lib, tripId, (trip) => {
    const span = checkDates(startDate, endDate);
    if (typeof span !== 'number') return span;
    let next = withField(trip, 'startDate', startDate, ctx.now);
    next = withField(next, 'endDate', endDate, ctx.now);
    if (span < trip.days.length) {
      const returned = trip.days.slice(span).flatMap((d) => d.stops.value.map((s) => s.placeId));
      next = { ...next, days: trip.days.slice(0, span) };
      next = withField(next, 'candidates', [...trip.candidates.value, ...returned], ctx.now);
    } else if (span > trip.days.length) {
      const added = Array.from({ length: span - trip.days.length }, () => newDay(ctx.now));
      next = { ...next, days: [...trip.days, ...added] };
    }
    return next;
  });
}

export function setOrigin(
  lib: Library,
  tripId: string,
  placeId: string | null,
  ctx: OpCtx,
): OpResult {
  return updateTrip(lib, tripId, (trip) => {
    if (placeId === trip.origin.value) return trip;
    if (placeId !== null && !isLivePlace(lib, placeId)) return notFound(placeId);
    return withField(trip, 'origin', placeId, ctx.now);
  });
}

/** 묘비를 남긴다. 이미 지운 여행은 처음 지운 시각을 유지한다. */
export function deleteTrip(lib: Library, tripId: string, ctx: OpCtx): OpResult {
  const trip = lib.trips[tripId];
  if (trip === undefined) return fail(notFound(tripId));
  if (trip.deletedAt !== null) return { ok: true, lib };
  return { ok: true, lib: withTrip(lib, trip, { ...trip, deletedAt: ctx.now }) };
}

// 되살리는 데는 시각이 필요 없지만, 모든 변경 함수가 같은 모양(lib, ..., ctx)을 갖도록 `ctx`를 받는다.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function restoreTrip(lib: Library, tripId: string, _ctx: OpCtx): OpResult {
  const trip = lib.trips[tripId];
  if (trip === undefined) return fail(notFound(tripId));
  if (trip.deletedAt === null) return { ok: true, lib };
  return { ok: true, lib: withTrip(lib, trip, { ...trip, deletedAt: null }) };
}

// ---------- 후보 ----------

/**
 * 후보 끝에 더한다. 이미 여행에 있는 장소(후보·Day)·중복·모르는 장소·지운 장소는 건너뛴다.
 * `summary.created`는 새로 넣은 수다(`<N>곳을 후보에 넣었어요`).
 */
export function addCandidates(
  lib: Library,
  tripId: string,
  placeIds: string[],
  ctx: OpCtx,
): OpResult {
  let created = 0;
  const result = updateTrip(lib, tripId, (trip) => {
    const added = [...new Set(placeIds)].filter(
      (p) => isLivePlace(lib, p) && locatePlace(trip, p) === null,
    );
    created = added.length;
    return withField(trip, 'candidates', [...trip.candidates.value, ...added], ctx.now);
  });
  return result.ok ? { ...result, summary: { created, merged: 0, restored: 0 } } : result;
}

export function removeCandidate(
  lib: Library,
  tripId: string,
  placeId: string,
  ctx: OpCtx,
): OpResult {
  return updateTrip(lib, tripId, (trip) =>
    withField(
      trip,
      'candidates',
      trip.candidates.value.filter((p) => p !== placeId),
      ctx.now,
    ),
  );
}

// ---------- Day의 장소 ----------

/**
 * 장소를 Day `dayIndex`의 `position`번째(옮긴 뒤 기준, [0, 길이]로 맞춤)에 둔다.
 * 다른 Day에 있으면 그 Stop(id·체류·고정 시각·메모)을 옮기고, 후보이거나 여행에 없던 장소면
 * 새 Stop을 만든다. 후보 칸이 오래된 화면이라 이미 Day에 있는 장소를 넣으려 해도
 * 거절하지 않고 옮긴다("장소 한 번만" 규칙). 이미 그 자리면 그대로다.
 */
export function insertStop(
  lib: Library,
  tripId: string,
  placeId: string,
  dayIndex: number,
  position: number,
  ctx: OpCtx,
): OpResult {
  return updateTrip(lib, tripId, (trip) => {
    if (!hasDay(trip, dayIndex)) return notFound(dayId(tripId, dayIndex));
    const loc = locatePlace(trip, placeId);
    let next = trip;
    let moving: Stop;
    if (loc?.where === 'day') {
      const from = trip.days[loc.dayIndex]!.stops.value;
      moving = from[loc.stopIndex]!;
      const rest = without(from, loc.stopIndex);
      if (loc.dayIndex === dayIndex) {
        const at = clamp(position, 0, rest.length);
        if (at === loc.stopIndex) return trip;
        return withDayField(trip, dayIndex, 'stops', insertAt(rest, at, moving), ctx.now);
      }
      next = withDayField(next, loc.dayIndex, 'stops', rest, ctx.now);
    } else {
      if (loc === null && !isLivePlace(lib, placeId)) return notFound(placeId);
      if (loc?.where === 'candidate') {
        const rest = trip.candidates.value.filter((p) => p !== placeId);
        next = withField(next, 'candidates', rest, ctx.now);
      }
      moving = { id: ctx.newId('stop'), placeId, stayMin: null, fixedTime: null, note: '' };
    }
    const target = next.days[dayIndex]!.stops.value;
    const at = clamp(position, 0, target.length);
    return withDayField(next, dayIndex, 'stops', insertAt(target, at, moving), ctx.now);
  });
}

export function moveStop(
  lib: Library,
  tripId: string,
  stopId: string,
  dayIndex: number,
  position: number,
  ctx: OpCtx,
): OpResult {
  const trip = liveTrip(lib, tripId);
  if (trip === null) return fail(notFound(tripId));
  const found = findStop(trip, stopId);
  if (found === null) return fail(notFound(stopId));
  return insertStop(lib, tripId, found.stop.placeId, dayIndex, position, ctx);
}

/** Day에서 빼서 후보 끝에 둔다. */
export function unscheduleStop(lib: Library, tripId: string, stopId: string, ctx: OpCtx): OpResult {
  return updateTrip(lib, tripId, (trip) => {
    const found = findStop(trip, stopId);
    if (found === null) return notFound(stopId);
    const rest = without(trip.days[found.dayIndex]!.stops.value, found.stopIndex);
    const next = withDayField(trip, found.dayIndex, 'stops', rest, ctx.now);
    return withField(next, 'candidates', [...trip.candidates.value, found.stop.placeId], ctx.now);
  });
}

/** Stop 하나를 고친다. `update`가 같은 Stop을 돌려주면 그대로다. */
function updateStop(
  lib: Library,
  tripId: string,
  stopId: string,
  ctx: OpCtx,
  update: (stop: Stop) => Stop,
): OpResult {
  return updateTrip(lib, tripId, (trip) => {
    const found = findStop(trip, stopId);
    if (found === null) return notFound(stopId);
    const next = update(found.stop);
    if (next === found.stop) return trip;
    const stops = trip.days[found.dayIndex]!.stops.value.slice();
    stops[found.stopIndex] = next;
    return withDayField(trip, found.dayIndex, 'stops', stops, ctx.now);
  });
}

/** 체류 시간(분). 0–1440 정수로 맞추고, 숫자가 아니면 비운다(`null` = 기본값). */
export function setStopStay(
  lib: Library,
  tripId: string,
  stopId: string,
  minutes: number | null,
  ctx: OpCtx,
): OpResult {
  const stayMin =
    minutes === null || !Number.isFinite(minutes)
      ? null
      : Math.min(LIBRARY_LIMITS.stayMaxMin, Math.max(0, Math.round(minutes)));
  return updateStop(lib, tripId, stopId, ctx, (s) =>
    s.stayMin === stayMin ? s : { ...s, stayMin },
  );
}

/**
 * 고정 시각('HH:mm'). 빈 문자열(시각 입력란을 비움)은 `null`(고정 해제)로 본다.
 * 그 밖에 형식이 틀린 값은 무시한다(입력란이 막는다).
 */
export function setStopFixedTime(
  lib: Library,
  tripId: string,
  stopId: string,
  fixedTime: string | null,
  ctx: OpCtx,
): OpResult {
  const value = fixedTime === '' ? null : fixedTime;
  return updateStop(lib, tripId, stopId, ctx, (s) =>
    s.fixedTime === value || (value !== null && !HHMM.test(value)) ? s : { ...s, fixedTime: value },
  );
}

/** 메모. 500자를 넘으면 자른다(입력란이 막는다). */
export function setStopNote(
  lib: Library,
  tripId: string,
  stopId: string,
  note: string,
  ctx: OpCtx,
): OpResult {
  const clipped = note.slice(0, LIBRARY_LIMITS.stopNoteChars);
  return updateStop(lib, tripId, stopId, ctx, (s) =>
    s.note === clipped ? s : { ...s, note: clipped },
  );
}

// ---------- Day 설정 ----------

/** 그날 밤 숙소. `alsoFollowingDays`면 그 뒤 Day들의 숙소도 같은 곳으로 바꾼다. */
export function setLodging(
  lib: Library,
  tripId: string,
  dayIndex: number,
  placeId: string | null,
  alsoFollowingDays: boolean,
  ctx: OpCtx,
): OpResult {
  return updateTrip(lib, tripId, (trip) => {
    if (!hasDay(trip, dayIndex)) return notFound(dayId(tripId, dayIndex));
    const last = alsoFollowingDays ? trip.days.length - 1 : dayIndex;
    let next = trip;
    for (let d = dayIndex; d <= last; d++) {
      if (trip.days[d]!.lodging.value === placeId) continue;
      if (placeId !== null && !isLivePlace(lib, placeId)) return notFound(placeId);
      next = withDayField(next, d, 'lodging', placeId, ctx.now);
    }
    return next;
  });
}

/** Day 출발 시각('HH:mm'). 필수라 빈 값·형식이 틀린 값은 무시한다(입력란이 막는다). */
export function setDayStartTime(
  lib: Library,
  tripId: string,
  dayIndex: number,
  startTime: string,
  ctx: OpCtx,
): OpResult {
  return updateTrip(lib, tripId, (trip) => {
    if (!hasDay(trip, dayIndex)) return notFound(dayId(tripId, dayIndex));
    if (!HHMM.test(startTime)) return trip;
    return withDayField(trip, dayIndex, 'startTime', startTime, ctx.now);
  });
}

/**
 * 구간 수단을 사람이 고른다. 자동 값(직선 800m 이하 도보, 그 밖 자동차)과 같으면 기록을 지운다.
 * 자동 값은 저장된 값과 상관없이 두 장소의 직선거리로 직접 계산한다.
 * 직선 50km를 넘는 구간에 도보를 고르면 무시한다(도보 불가).
 */
export function setLegMode(
  lib: Library,
  tripId: string,
  fromId: string,
  toId: string,
  mode: 'car' | 'walk',
  ctx: OpCtx,
): OpResult {
  return updateTrip(lib, tripId, (trip) => {
    const from = lib.places[fromId];
    const to = lib.places[toId];
    if (from === undefined) return notFound(fromId);
    if (to === undefined) return notFound(toId);
    const straightM = haversineM([from.lng, from.lat], [to.lng, to.lat]);
    if (mode === 'walk' && straightM > WALK_MAX_M) return trip;
    const key = legKey(fromId, toId);
    const current = trip.legModes.value;
    // 이미 있던 키를 덮어쓰면 자리가 그대로라 직렬화 비교가 불필요한 갱신을 만들지 않는다.
    const next =
      mode === autoMode(straightM)
        ? Object.fromEntries(Object.entries(current).filter(([k]) => k !== key))
        : { ...current, [key]: mode };
    return withField(trip, 'legModes', next, ctx.now);
  });
}

/** 순서 정리 결과. `stopIds`는 그 Day의 Stop id와 같은 집합이어야 한다. 다르면 다른 곳이 바꾼 것이다. */
export function reorderDay(
  lib: Library,
  tripId: string,
  dayIndex: number,
  stopIds: string[],
  ctx: OpCtx,
): OpResult {
  return updateTrip(lib, tripId, (trip) => {
    if (!hasDay(trip, dayIndex)) return notFound(dayId(tripId, dayIndex));
    const stops = trip.days[dayIndex]!.stops.value;
    const byId = new Map(stops.map((s) => [s.id, s]));
    const sameSet =
      stopIds.length === stops.length &&
      new Set(stopIds).size === stopIds.length &&
      stopIds.every((id) => byId.has(id));
    if (!sameSet) {
      const stray =
        stopIds.find((id) => !byId.has(id)) ?? stops.find((s) => !stopIds.includes(s.id))?.id;
      return notFound(stray ?? dayId(tripId, dayIndex));
    }
    return withDayField(
      trip,
      dayIndex,
      'stops',
      stopIds.map((id) => byId.get(id)!),
      ctx.now,
    );
  });
}

/**
 * Day 자동 나누기 미리보기를 적용한다. `plan[d]`는 Day d의 전체 장소 순서다.
 * 기존 Stop은 그대로(id·체류·메모) 옮기고, 후보에서 온 장소는 새 Stop으로 만들어 후보에서 뺀다.
 * 보관함에서 지운 장소의 Stop은 plan에 없어도 Day의 제 칸에 그대로 둔다(스펙 §3.3: 되살리면 원래 자리).
 * 미리보기 뒤에 문서가 바뀌었을 수 있어, 여행에 없는 장소는 무시하고(먼저 나온 자리 우선)
 * plan에 빠진 기존 Stop(보이는 장소)은 원래 Day 끝에 남긴다.
 */
export function applyAutoSplit(
  lib: Library,
  tripId: string,
  plan: string[][],
  ctx: OpCtx,
): OpResult {
  return updateTrip(lib, tripId, (trip) => {
    const existing = new Map<string, Stop>();
    for (const day of trip.days) for (const s of day.stops.value) existing.set(s.placeId, s);
    const isCandidate = new Set(trip.candidates.value);

    const placed = new Set<string>();
    const assigned = trip.days.map((_, d) =>
      (plan[d] ?? []).filter((p) => {
        if (placed.has(p) || !(existing.has(p) || isCandidate.has(p))) return false;
        placed.add(p);
        return true;
      }),
    );

    const toStop = (placeId: string): Stop =>
      existing.get(placeId) ?? {
        id: ctx.newId('stop'),
        placeId,
        stayMin: null,
        fixedTime: null,
        note: '',
      };

    let next = trip;
    trip.days.forEach((day, d) => {
      // 원래 Stop 자리를 따라가며 채운다: 지운 장소의 Stop(plan에 없음)은 제 칸을 지키고(되살리면 원래 자리),
      // plan에 든 Stop의 칸은 plan 순서대로 다음 장소가 차지한다. 남은 plan 장소는 끝에 붙인다.
      const queue = [...assigned[d]!];
      const slotted: Stop[] = [];
      const strays: Stop[] = [];
      for (const s of day.stops.value) {
        if (placed.has(s.placeId)) {
          const placeId = queue.shift();
          if (placeId !== undefined) slotted.push(toStop(placeId));
        } else if (isLivePlace(lib, s.placeId)) strays.push(s);
        else slotted.push(s);
      }
      const stops = [...slotted, ...queue.map(toStop), ...strays];
      next = withDayField(next, d, 'stops', stops, ctx.now);
    });
    return withField(
      next,
      'candidates',
      trip.candidates.value.filter((p) => !placed.has(p)),
      ctx.now,
    );
  });
}
