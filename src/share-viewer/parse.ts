import { checkShareTrip, SHARE_TRIP_LIMITS } from 'src/domain/share/check-share-trip';
import { LABEL_COLORS } from 'src/schema/label-colors';
import type {
  ShareDay,
  ShareDoc,
  ShareDocV1,
  ShareDocV2,
  ShareLabel,
  ShareLeg,
  SharePlace,
  ShareStop,
  ShareTrip,
} from 'src/schema/share';

/**
 * 보기 화면이 데이터 블록을 읽고 검사한다. Effect를 번들에 넣지 않으려고 `src/schema/share.ts`의
 * 스키마 대신 손으로 검사한다(타입만 import). 형식이 조금이라도 다르면 null이다.
 * v2는 `ShareDocV2Schema`의 필드 규칙을 그대로 손으로 옮기고, 이어서 장소 1곳 이상과
 * 관계 검사(`checkShareTrip`)를 통과해야 한다. 읽은 값은 아는 필드만 담아 돌려준다(모르는 필드는 버린다, v1과 같다).
 */

/** 한 줄 평 글자 수 한도(`LIBRARY_LIMITS.reviewChars`와 같다. 스키마 모듈은 런타임 import 금지). */
const REVIEW_MAX_CHARS = 140;

type Rec = Record<string, unknown>;

function isRecord(x: unknown): x is Rec {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function parseLabel(x: unknown): ShareLabel | null {
  if (!isRecord(x)) return null;
  const { id, name, color, order } = x;
  if (typeof id !== 'string' || typeof name !== 'string') return null;
  if (typeof color !== 'string' || !(LABEL_COLORS as readonly string[]).includes(color))
    return null;
  if (!isFiniteNumber(order)) return null;
  return { id, name, color: color as ShareLabel['color'], order };
}

/** `Lng`·`Lat`(src/schema/common.ts)과 같은 범위. v2 장소만 확인한다. */
function inKorea(lng: number, lat: number): boolean {
  return lng >= 124 && lng <= 132 && lat >= 33 && lat <= 39;
}

function parsePlace(x: unknown, v2 = false): SharePlace | null {
  if (!isRecord(x)) return null;
  const { id, name, address, lng, lat, labelIds, memo, naverSid, kakaoId, googleId, review } = x;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof address !== 'string')
    return null;
  if (!isFiniteNumber(lng) || !isFiniteNumber(lat)) return null;
  if (!Array.isArray(labelIds) || !labelIds.every((v) => typeof v === 'string')) return null;
  if (memo !== undefined && typeof memo !== 'string') return null;
  if (naverSid !== undefined && typeof naverSid !== 'string') return null;
  if (kakaoId !== undefined && typeof kakaoId !== 'string') return null;
  if (googleId !== undefined && typeof googleId !== 'string') return null;
  if (v2) {
    if (!inKorea(lng, lat)) return null;
    if (review !== undefined && (typeof review !== 'string' || review.length > REVIEW_MAX_CHARS)) {
      return null;
    }
  }
  const place: SharePlace = { id, name, address, lng, lat, labelIds: [...(labelIds as string[])] };
  if (memo !== undefined) place.memo = memo;
  if (naverSid !== undefined) place.naverSid = naverSid;
  if (kakaoId !== undefined) place.kakaoId = kakaoId;
  if (googleId !== undefined) place.googleId = googleId;
  if (v2 && review !== undefined) place.review = review as string;
  return place;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `toISOString()` 형식(UTC, `Z`)이며 실제 시각. */
function isIsoDateTime(x: unknown): x is string {
  if (typeof x !== 'string' || !ISO_DATETIME.test(x)) return false;
  const t = new Date(x);
  return !Number.isNaN(t.getTime()) && t.toISOString() === x;
}

/** `YYYY-MM-DD`이며 실제 달력 날짜. */
function isCalendarDate(x: unknown): x is string {
  if (typeof x !== 'string' || !CALENDAR_DATE.test(x)) return false;
  const [y, m, d] = x.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const isStringArray = (x: unknown): x is string[] =>
  Array.isArray(x) && x.every((v) => typeof v === 'string');

const isMode = (x: unknown): x is 'car' | 'walk' => x === 'car' || x === 'walk';

function parseStop(x: unknown): ShareStop | null {
  if (!isRecord(x)) return null;
  const { placeId, stayMin, fixedTime, note } = x;
  if (typeof placeId !== 'string') return null;
  if (
    stayMin !== null &&
    !(
      typeof stayMin === 'number' &&
      Number.isInteger(stayMin) &&
      stayMin >= 0 &&
      stayMin <= SHARE_TRIP_LIMITS.stayMaxMin
    )
  ) {
    return null;
  }
  if (fixedTime !== null && !(typeof fixedTime === 'string' && HHMM.test(fixedTime))) return null;
  if (
    note !== undefined &&
    (typeof note !== 'string' || note.length > SHARE_TRIP_LIMITS.stopNoteChars)
  ) {
    return null;
  }
  const stop: ShareStop = {
    placeId,
    stayMin: stayMin as number | null,
    fixedTime: fixedTime as string | null,
  };
  if (note !== undefined) stop.note = note;
  return stop;
}

function parsePoint(x: unknown): [number, number] | null {
  if (!Array.isArray(x) || x.length !== 2) return null;
  const [lng, lat] = x as unknown[];
  if (!isFiniteNumber(lng) || !isFiniteNumber(lat)) return null;
  return [lng, lat];
}

const LEG_STATUSES: readonly string[] = ['routed', 'estimated', 'no-route', 'same-point'];

function parseLeg(x: unknown): ShareLeg | null {
  if (!isRecord(x)) return null;
  const { from, to, mode, durationS, distanceM, tollFare, status, queriedAt, path } = x;
  if (typeof from !== 'string' || typeof to !== 'string' || !isMode(mode)) return null;
  if (!isFiniteNumber(durationS) || !isFiniteNumber(distanceM)) return null;
  if (tollFare !== null && !isFiniteNumber(tollFare)) return null;
  if (typeof status !== 'string' || !LEG_STATUSES.includes(status)) return null;
  if (queriedAt !== null && !isIsoDateTime(queriedAt)) return null;
  if (!Array.isArray(path)) return null;
  const points: [number, number][] = [];
  for (const raw of path as unknown[]) {
    const point = parsePoint(raw);
    if (point === null) return null;
    points.push(point);
  }
  return {
    from,
    to,
    mode,
    durationS,
    distanceM,
    tollFare: tollFare as number | null,
    status: status as ShareLeg['status'],
    queriedAt: queriedAt as string | null,
    path: points,
  };
}

function parseDay(x: unknown): ShareDay | null {
  if (!isRecord(x)) return null;
  const { startTime, lodgingId, stops, legs } = x;
  if (typeof startTime !== 'string' || !HHMM.test(startTime)) return null;
  if (lodgingId !== null && typeof lodgingId !== 'string') return null;
  if (!Array.isArray(stops) || !Array.isArray(legs)) return null;
  const parsedStops: ShareStop[] = [];
  for (const raw of stops as unknown[]) {
    const stop = parseStop(raw);
    if (stop === null) return null;
    parsedStops.push(stop);
  }
  const parsedLegs: ShareLeg[] = [];
  for (const raw of legs as unknown[]) {
    const leg = parseLeg(raw);
    if (leg === null) return null;
    parsedLegs.push(leg);
  }
  return { startTime, lodgingId: lodgingId as string | null, stops: parsedStops, legs: parsedLegs };
}

function parseTrip(x: unknown): ShareTrip | null {
  if (!isRecord(x)) return null;
  const { title, startDate, endDate, originId, candidateIds, days, legModes } = x;
  if (typeof title !== 'string') return null;
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) return null;
  if (originId !== null && typeof originId !== 'string') return null;
  if (!isStringArray(candidateIds) || !Array.isArray(days)) return null;
  if (!isRecord(legModes)) return null;
  const modes: Record<string, 'car' | 'walk'> = {};
  for (const [key, mode] of Object.entries(legModes)) {
    if (!isMode(mode)) return null;
    modes[key] = mode;
  }
  const parsedDays: ShareDay[] = [];
  for (const raw of days as unknown[]) {
    const day = parseDay(raw);
    if (day === null) return null;
    parsedDays.push(day);
  }
  return {
    title,
    startDate,
    endDate,
    originId: originId as string | null,
    candidateIds: [...candidateIds],
    days: parsedDays,
    legModes: modes,
  };
}

/** v1·v2 공통 머리(`labels`·`places`)를 읽는다. 틀리면 null. */
function parseCommon(
  value: Rec,
  v2: boolean,
): { title: string; createdAt: string; labels: ShareLabel[]; places: SharePlace[] } | null {
  const { title, createdAt, labels, places } = value;
  if (typeof title !== 'string') return null;
  if (v2 ? !isIsoDateTime(createdAt) : typeof createdAt !== 'string') return null;
  if (!Array.isArray(labels) || !Array.isArray(places)) return null;

  const parsedLabels: ShareLabel[] = [];
  for (const raw of labels) {
    const label = parseLabel(raw);
    if (label === null) return null;
    parsedLabels.push(label);
  }
  const parsedPlaces: SharePlace[] = [];
  for (const raw of places) {
    const place = parsePlace(raw, v2);
    if (place === null) return null;
    parsedPlaces.push(place);
  }
  return { title, createdAt: createdAt as string, labels: parsedLabels, places: parsedPlaces };
}

function parseV2(value: Rec): ShareDocV2 | null {
  const head = parseCommon(value, true);
  if (head === null) return null;
  const { trips } = value;
  if (!Array.isArray(trips) || trips.length !== SHARE_TRIP_LIMITS.trips) return null;
  const parsedTrips: ShareTrip[] = [];
  for (const raw of trips as unknown[]) {
    const trip = parseTrip(raw);
    if (trip === null) return null;
    parsedTrips.push(trip);
  }
  const doc: ShareDocV2 = { format: 'tripmap-share', version: 2, ...head, trips: parsedTrips };
  if (doc.places.length < 1) return null;
  if (checkShareTrip(doc).length > 0) return null;
  return doc;
}

function parseV1(value: Rec): ShareDocV1 | null {
  const head = parseCommon(value, false);
  if (head === null) return null;
  return { format: 'tripmap-share', version: 1, ...head };
}

/** 값이 `ShareDoc` 형식이면 돌려주고, 아니면 null. 던지지 않는다. */
export function parseShareDoc(value: unknown): ShareDoc | null {
  if (!isRecord(value) || value.format !== 'tripmap-share') return null;
  if (value.version === 1) return parseV1(value);
  if (value.version === 2) return parseV2(value);
  return null;
}

/** `<script type="application/json" id="tripmap-share">`의 내용을 읽는다. 없거나 깨졌으면 null. */
export function readShareDoc(doc: Document): ShareDoc | null {
  try {
    const text = doc.getElementById('tripmap-share')?.textContent;
    if (text === null || text === undefined) return null;
    return parseShareDoc(JSON.parse(text));
  } catch {
    return null;
  }
}

/** 링크는 앱의 엄격한 필드 검사와 같은 규칙을 쓴다. 파일 보기의 관대한 검사는 유지한다. */
export function parseLinkDoc(value: unknown): ShareDoc | null {
  const keys = (x: unknown, allowed: string): x is Rec =>
    isRecord(x) && Object.keys(x).every((key) => allowed.split(' ').includes(key));
  if (!keys(value, 'format version title createdAt labels places trips')) return null;
  const v2 = value.version === 2;
  if (!v2 && 'trips' in value) return null;
  if (!isIsoDateTime(value.createdAt)) return null;
  if (!Array.isArray(value.places) || value.places.length < 1 || value.places.length > 1000)
    return null;
  if (!Array.isArray(value.labels)) return null;
  const unique = (items: Rec[]) => new Set(items.map((x) => x.id)).size === items.length;
  for (const p of value.places) {
    if (
      !keys(
        p,
        `id name address lng lat labelIds memo naverSid kakaoId googleId${v2 ? ' review' : ''}`,
      )
    )
      return null;
    if (!isFiniteNumber(p.lng) || !isFiniteNumber(p.lat) || !inKorea(p.lng, p.lat)) return null;
  }
  if (!value.labels.every((l) => keys(l, 'id name color order'))) return null;
  if (!unique(value.places as Rec[]) || !unique(value.labels as Rec[])) return null;
  if (v2) {
    if (!Array.isArray(value.trips)) return null;
    for (const t of value.trips) {
      if (
        !keys(t, 'title startDate endDate originId candidateIds days legModes') ||
        !Array.isArray(t.days)
      )
        return null;
      for (const d of t.days) {
        if (
          !keys(d, 'startTime lodgingId stops legs') ||
          !Array.isArray(d.stops) ||
          !Array.isArray(d.legs)
        )
          return null;
        if (!d.stops.every((x) => keys(x, 'placeId stayMin fixedTime note'))) return null;
        if (
          !d.legs.every((x) =>
            keys(x, 'from to mode durationS distanceM tollFare status queriedAt path'),
          )
        )
          return null;
      }
    }
  }
  return parseShareDoc(value);
}
