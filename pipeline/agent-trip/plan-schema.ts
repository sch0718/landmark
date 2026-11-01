import { Schema } from 'effect';
import { AGENT_INBOX_LIMITS, AGENT_PLACE_LIMITS } from 'src/domain/share/agent-limits';
import { SHARE_TRIP_LIMITS } from 'src/domain/share/check-share-trip';
import { daysBetween } from 'src/lib/calendar';
import { CalendarDate, HHmm, Lat, Lng } from 'src/schema/common';
import { LIBRARY_LIMITS } from 'src/schema/library-base';
import { MutableArray, MutableRecord, MutableStruct } from 'src/schema/mutable';
import { safeParse } from 'src/schema/parse';
import { EXIT, TripFailure, type TripIssue } from './errors';

export type PlanPlace = {
  key: string;
  naverSid?: string;
  link?: string;
  search?: { q: string; near?: [number, number] };
  name?: string;
  address?: string;
  lng?: number;
  lat?: number;
  memo?: string;
};

export type PlanStop = {
  place: string;
  stayMin?: number | null;
  fixedTime?: string | null;
  note?: string;
};

export type PlanDay = { startTime?: string; lodging?: string | null; stops: PlanStop[] };

export type TripPlan = {
  format: 'landmark-trip-plan';
  version: 1;
  title: string;
  startDate: string;
  endDate: string;
  origin?: string | null;
  places: PlanPlace[];
  days: PlanDay[];
  candidates?: string[];
  legModes?: Record<string, 'car' | 'walk'>;
};

const text = (minimum: number, maximum: number) =>
  Schema.String.check(
    Schema.isMinLength(minimum, { message: `${minimum}자 이상이어야 해요` }),
    Schema.isMaxLength(maximum, { message: `${maximum}자까지 쓸 수 있어요` }),
  );

const PlanPlaceSchema = MutableStruct({
  key: Schema.String.check(
    Schema.isPattern(/^[A-Za-z0-9_-]{1,40}$/, { message: 'key는 영숫자·_·-로 1~40자여야 해요' }),
  ),
  naverSid: Schema.optionalKey(
    Schema.String.check(
      Schema.isPattern(AGENT_PLACE_LIMITS.numericIdPattern, {
        message: '네이버 sid는 숫자 1~20자여야 해요',
      }),
    ),
  ),
  link: Schema.optionalKey(text(1, 2000)),
  search: Schema.optionalKey(
    MutableStruct({
      q: text(1, 40),
      near: Schema.optionalKey(Schema.mutable(Schema.Tuple([Lng, Lat]))),
    }),
  ),
  name: Schema.optionalKey(text(1, AGENT_PLACE_LIMITS.nameChars)),
  address: Schema.optionalKey(text(0, AGENT_PLACE_LIMITS.addressChars)),
  lng: Schema.optionalKey(Lng),
  lat: Schema.optionalKey(Lat),
  memo: Schema.optionalKey(text(0, LIBRARY_LIMITS.memoChars)),
});

const PlanStopSchema = MutableStruct({
  place: Schema.String,
  stayMin: Schema.optionalKey(
    Schema.NullOr(
      Schema.Finite.check(
        Schema.isInt({ message: '머무는 시간은 정수여야 해요' }),
        Schema.isBetween(
          { minimum: 0, maximum: LIBRARY_LIMITS.stayMaxMin },
          { message: '머무는 시간은 0~1440분이어야 해요' },
        ),
      ),
    ),
  ),
  fixedTime: Schema.optionalKey(Schema.NullOr(HHmm)),
  note: Schema.optionalKey(text(0, LIBRARY_LIMITS.stopNoteChars)),
});

const PlanDaySchema = MutableStruct({
  startTime: Schema.optionalKey(HHmm),
  lodging: Schema.optionalKey(Schema.NullOr(Schema.String)),
  stops: MutableArray(PlanStopSchema),
});

export const TripPlanSchema = MutableStruct({
  format: Schema.Literal('landmark-trip-plan'),
  version: Schema.Literal(1),
  title: text(1, LIBRARY_LIMITS.tripTitleChars),
  startDate: CalendarDate,
  endDate: CalendarDate,
  origin: Schema.optionalKey(Schema.NullOr(Schema.String)),
  places: MutableArray(PlanPlaceSchema).check(
    Schema.isMinLength(1, { message: '장소를 하나 이상 적어 주세요' }),
    Schema.isMaxLength(AGENT_INBOX_LIMITS.places, { message: '장소는 200곳까지 적을 수 있어요' }),
  ),
  days: MutableArray(PlanDaySchema),
  candidates: Schema.optionalKey(MutableArray(Schema.String)),
  legModes: Schema.optionalKey(MutableRecord(Schema.String, Schema.Literals(['car', 'walk']))),
}) satisfies Schema.Codec<TripPlan, unknown>;

/** Effect의 점 경로를 계획 파일의 배열·레코드 경로로 바꾼다. */
export function toPlanPath(path: string): string {
  if (path.startsWith('legModes.'))
    return `legModes[${JSON.stringify(path.slice('legModes.'.length))}]`;
  return path.replace(/\.(\d+)(?=\.|$)/g, '[$1]');
}

/** 스키마 검사 다음에 관계 오류를 모두 모아 알린다. */
export function parsePlan(value: unknown): TripPlan {
  const parsed = safeParse(TripPlanSchema, value, { onExcessProperty: 'error' });
  if (!parsed.success) {
    throw new TripFailure(
      parsed.issues.map((issue) => ({
        path: toPlanPath(issue.path),
        code: 'schema',
        message: issue.message,
      })),
      EXIT.input,
    );
  }
  const plan = parsed.data;
  const issues: TripIssue[] = [];
  const add = (path: string, code: TripIssue['code'], message: string) => {
    issues.push({ path, code, message });
  };

  const keys = new Set<string>();
  const sids = new Set<string>();
  plan.places.forEach((place, i) => {
    const path = `places[${i}]`;
    const sources = [place.naverSid, place.link, place.search].filter(
      (source) => source !== undefined,
    ).length;
    if (sources > 1) add(path, 'schema', '장소 출처는 하나만 적을 수 있어요');
    if (
      sources === 0 &&
      (place.name === undefined || place.lng === undefined || place.lat === undefined)
    ) {
      add(path, 'schema', '핀에는 name·lng·lat이 모두 필요해요');
    }
    if (keys.has(place.key)) add(`${path}.key`, 'schema', '장소 key가 겹쳐요');
    keys.add(place.key);
    if (place.naverSid !== undefined) {
      if (sids.has(place.naverSid)) add(`${path}.naverSid`, 'duplicate-sid', '네이버 sid가 겹쳐요');
      sids.add(place.naverSid);
    }
  });

  const span = daysBetween(plan.startDate, plan.endDate);
  if (span < 1 || span > SHARE_TRIP_LIMITS.maxDays) {
    add('endDate', 'schema', `여행 기간은 1~${SHARE_TRIP_LIMITS.maxDays}일이어야 해요`);
  }
  if (span !== plan.days.length) {
    add('days', 'day-count', `기간은 ${span}일인데 days가 ${plan.days.length}개예요`);
  }

  const used = new Set<string>();
  const placed = new Set<string>();
  const reference = (key: string, path: string, once = false) => {
    if (!keys.has(key)) add(path, 'unknown-place', `places에 없는 key예요 (${key})`);
    else used.add(key);
    if (once) {
      if (placed.has(key))
        add(path, 'duplicate-in-trip', '장소는 Stop·후보 전체에서 한 번만 넣을 수 있어요');
      placed.add(key);
    }
  };
  if (plan.origin != null) reference(plan.origin, 'origin');
  plan.days.forEach((day, di) => {
    if (day.lodging != null) reference(day.lodging, `days[${di}].lodging`);
    day.stops.forEach((stop, si) => reference(stop.place, `days[${di}].stops[${si}].place`, true));
  });
  plan.candidates?.forEach((key, i) => reference(key, `candidates[${i}]`, true));
  if (used.size === 0) add('days', 'no-places', '여행이 참조하는 장소가 하나도 없어요');

  for (const key of Object.keys(plan.legModes ?? {})) {
    const [from, to] = key.split('>');
    if (!/^[^>]+>[^>]+$/.test(key) || !keys.has(from!) || !keys.has(to!)) {
      add(
        `legModes[${JSON.stringify(key)}]`,
        'leg-modes',
        'legModes 키는 places에 있는 두 key를 >로 이어야 해요',
      );
    }
  }
  if (issues.length > 0) throw new TripFailure(issues, EXIT.input);
  return plan;
}

/** Struct만 닫고 Record의 값 스키마는 유지한 표준 JSON Schema 문서. */
export function planJsonSchema(): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(TripPlanSchema, { onExcessProperty: 'error' });
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    ...document.schema,
    $defs: document.definitions,
  };
}
