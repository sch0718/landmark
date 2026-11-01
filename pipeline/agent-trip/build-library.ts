import { newPlace } from 'src/domain/library/add-place';
import type { OpCtx, OpResult } from 'src/domain/library/ops';
import { haversineM, WALK_MAX_M } from 'src/domain/trips/geo';
import {
  createTrip,
  insertStop,
  setDayStartTime,
  setLegMode,
  setLodging,
  setStopFixedTime,
  setStopNote,
  setStopStay,
} from 'src/domain/trips/ops';
import { legKey } from 'src/domain/trips/query';
import { emptyLibrary, LibrarySchema, type Library } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { randomId } from 'src/services/id-gen';
import { EXIT, TripFailure, type TripIssue } from './errors';
import type { TripPlan } from './plan-schema';
import type { ResolvedPlace } from './resolve-places';

export type BuiltLibrary = {
  lib: Library;
  tripId: string;
  /** 계획 key → PlaceId. */
  placeIds: Map<string, string>;
  now: string;
};

/** 실제 이웃 구간만 수단을 지정할 수 있고, 50km를 넘는 도보는 입력 오류다. */
export function checkLegModes(plan: TripPlan, places: ResolvedPlace[]): TripIssue[] {
  const adjacent = new Set<string>();
  plan.days.forEach((day, d) => {
    const start = d === 0 ? plan.origin : plan.days[d - 1]?.lodging;
    const points = [start, ...day.stops.map((stop) => stop.place), day.lodging].filter(
      (key): key is string => key != null,
    );
    for (let i = 0; i + 1 < points.length; i++) {
      adjacent.add(legKey(points[i]!, points[i + 1]!));
    }
  });

  const byKey = new Map(places.map((place) => [place.key, place.candidate]));
  const issues: TripIssue[] = [];
  for (const [key, mode] of Object.entries(plan.legModes ?? {})) {
    const path = `legModes[${JSON.stringify(key)}]`;
    if (!adjacent.has(key)) {
      issues.push({
        path,
        code: 'leg-modes',
        message: '그날 이웃한 두 장소의 구간만 지정할 수 있어요',
      });
      continue;
    }
    const [fromKey, toKey] = key.split('>');
    const from = byKey.get(fromKey!);
    const to = byKey.get(toKey!);
    if (
      mode === 'walk' &&
      from !== undefined &&
      to !== undefined &&
      haversineM([from.lng, from.lat], [to.lng, to.lat]) > WALK_MAX_M
    ) {
      issues.push({
        path,
        code: 'walk-too-far',
        message: '직선 50km를 넘는 구간은 도보로 지정할 수 없어요',
      });
    }
  }
  return issues;
}

/** 앱의 보관함·여행 연산으로 만들고, 마지막에 보관함 전체를 검사한다. */
export function buildLibrary(
  plan: TripPlan,
  places: ResolvedPlace[],
  now: Date,
  warnings: TripIssue[],
): BuiltLibrary {
  const legIssues = checkLegModes(plan, places);
  if (legIssues.length > 0) throw new TripFailure(legIssues, EXIT.input);

  const ctx: OpCtx = {
    now: now.toISOString(),
    newId: (kind) =>
      randomId(kind === 'label' || kind === 'stop' || kind === 'meetingMember' ? 8 : 10),
  };
  const placeIds = new Map<string, string>();
  let lib = emptyLibrary();
  const entries = places.map((r) => {
    const place = newPlace(ctx.newId('place'), r.candidate, [], r.memo, ctx.now);
    placeIds.set(r.key, place.id);
    return [place.id, place] as const;
  });
  lib = { ...lib, places: Object.fromEntries(entries) };

  const idOf = (key: string, path: string): string => {
    const id = placeIds.get(key);
    if (id === undefined) {
      throw new TripFailure(
        [{ path, code: 'unknown-place', message: '조회한 장소에 없는 key예요' }],
        EXIT.input,
      );
    }
    return id;
  };
  const apply = (result: OpResult, path: string): Extract<OpResult, { ok: true }> => {
    if (!result.ok) {
      const tag = result.error._tag;
      const errorPath =
        tag === 'TripDatesInvalid' ? 'endDate' : tag.includes('TitleInvalid') ? 'title' : path;
      throw new TripFailure(
        [{ path: errorPath, code: 'schema', message: `여행 설정을 적용하지 못했어요 (${tag})` }],
        EXIT.input,
      );
    }
    lib = result.lib;
    return result;
  };

  const created = apply(
    createTrip(
      lib,
      {
        title: plan.title,
        startDate: plan.startDate,
        endDate: plan.endDate,
        origin: plan.origin == null ? null : idOf(plan.origin, 'origin'),
        candidates: (plan.candidates ?? []).map((key, i) => idOf(key, `candidates[${i}]`)),
      },
      ctx,
    ),
    'days',
  );
  const tripId = created.createdId!;

  plan.days.forEach((day, d) => {
    day.stops.forEach((stop, position) => {
      const path = `days[${d}].stops[${position}]`;
      const placeId = idOf(stop.place, `${path}.place`);
      apply(insertStop(lib, tripId, placeId, d, position, ctx), path);
      const stopId = lib.trips[tripId]!.days[d]!.stops.value.find((s) => s.placeId === placeId)!.id;
      if (stop.stayMin !== undefined)
        apply(setStopStay(lib, tripId, stopId, stop.stayMin, ctx), path);
      if (stop.fixedTime !== undefined)
        apply(setStopFixedTime(lib, tripId, stopId, stop.fixedTime, ctx), path);
      if (stop.note !== undefined) apply(setStopNote(lib, tripId, stopId, stop.note, ctx), path);
    });
    if (day.lodging !== undefined) {
      const path = `days[${d}].lodging`;
      apply(
        setLodging(
          lib,
          tripId,
          d,
          day.lodging === null ? null : idOf(day.lodging, path),
          false,
          ctx,
        ),
        path,
      );
    }
    if (day.startTime !== undefined) {
      apply(setDayStartTime(lib, tripId, d, day.startTime, ctx), `days[${d}].startTime`);
    }
  });
  for (const [key, mode] of Object.entries(plan.legModes ?? {})) {
    const [from, to] = key.split('>');
    const path = `legModes[${JSON.stringify(key)}]`;
    apply(setLegMode(lib, tripId, idOf(from!, path), idOf(to!, path), mode, ctx), path);
  }

  const checked = safeParse(LibrarySchema, lib);
  if (!checked.success) {
    throw new TripFailure(
      checked.issues.map((issue) => ({
        path: issue.path,
        code: 'internal',
        message: `만든 보관함이 올바르지 않아요: ${issue.message}`,
      })),
      EXIT.internal,
    );
  }

  const used = new Set<string>(plan.candidates ?? []);
  if (plan.origin != null) used.add(plan.origin);
  for (const day of plan.days) {
    if (day.lodging != null) used.add(day.lodging);
    for (const stop of day.stops) used.add(stop.place);
  }
  for (const place of places) {
    if (!used.has(place.key)) {
      warnings.push({
        path: `places[${place.index}]`,
        code: 'unused-place',
        message: '쓰지 않는 장소라 문서에 넣지 않았어요',
      });
    }
  }
  return { lib, tripId, placeIds, now: ctx.now };
}
