import { importSharePlaces } from 'src/domain/library/import-share';
import { cutPrefix } from 'src/domain/library/legacy-import';
import type { OpCtx, OpResult } from 'src/domain/library/ops';
import { legKey } from 'src/domain/trips/query';
import { LIBRARY_LIMITS, normalizeLabelName, type Library } from 'src/schema/library';
import type { ShareDocV2, ShareTrip } from 'src/schema/share';
import { checkTrip, daysBetween, type Day, type Stop, type Trip } from 'src/schema/trip';

// 받은 v2 일정 파일을 새 여행으로 가져오는 연산(스펙 §8). 장소는 v1 규칙(`importSharePlaces`)으로 먼저 합치고,
// 그 대응표(받은 장소 id → 내 장소 id)로 새 `Trip`을 만든다. 입력을 바꾸지 않는 순수 함수다.

/** 받은 여행 제목이 비었을 때의 제목. */
export const RECEIVED_TRIP_TITLE = '받은 여행';

/** 앞뒤 공백을 지우고 60자(UTF-16)로 자른다. 비면 `받은 여행`. */
export function receivedTripTitle(title: string): string {
  return cutPrefix(title.trim(), LIBRARY_LIMITS.tripTitleChars) || RECEIVED_TRIP_TITLE;
}

/** 살아 있는 내 여행 중 제목(정규형)·시작일·종료일이 받은 여행과 같은 것이 있는가(스펙 §8.4 경고용). */
export function sameTripExists(lib: Library, trip: ShareTrip): boolean {
  const title = normalizeLabelName(receivedTripTitle(trip.title));
  return Object.values(lib.trips).some(
    (t) =>
      t.deletedAt === null &&
      normalizeLabelName(t.title.value) === title &&
      t.startDate.value === trip.startDate &&
      t.endDate.value === trip.endDate,
  );
}

/**
 * 받은 여행을 새 여행으로 만든다. `createdId`는 새 여행 id, `summary`는 장소 결과다.
 * 여행 안 "장소는 한 번만" 규칙을 위해 Day 순서로 처음 나온 Stop을 남기고 뒤의 Stop·후보를 뺀다.
 */
export function importSharedTrip(
  lib: Library,
  doc: ShareDocV2,
  input: { titleLabel: string | null; appendMemo: boolean },
  ctx: OpCtx,
): OpResult {
  const received = doc.trips[0]!;
  const placed = importSharePlaces(
    lib,
    doc,
    { selected: doc.places.map((p) => p.id), ...input },
    ctx,
  );
  if (!placed.ok) return placed;

  const mine = (receivedId: string): string => placed.placeIds.get(receivedId)!;
  const mineOrNull = (receivedId: string | null) => (receivedId === null ? null : mine(receivedId));
  const field = <V>(value: V) => ({ value, updatedAt: ctx.now });

  const used = new Set<string>();
  const days: Day[] = received.days.map((day) => {
    const stops: Stop[] = [];
    for (const stop of day.stops) {
      const placeId = mine(stop.placeId);
      if (used.has(placeId)) continue;
      used.add(placeId);
      stops.push({
        id: ctx.newId('stop'),
        placeId,
        stayMin: stop.stayMin,
        fixedTime: stop.fixedTime,
        note: stop.note ?? '',
      });
    }
    return {
      stops: field(stops),
      lodging: field(mineOrNull(day.lodgingId)),
      startTime: field(day.startTime),
    };
  });

  const candidates: string[] = [];
  for (const receivedId of received.candidateIds) {
    const placeId = mine(receivedId);
    if (used.has(placeId)) continue;
    used.add(placeId);
    candidates.push(placeId);
  }

  const legModes: Record<string, 'car' | 'walk'> = {};
  for (const [key, mode] of Object.entries(received.legModes)) {
    const [from, to] = key.split('>') as [string, string];
    const [a, b] = [mine(from), mine(to)];
    const mapped = legKey(a, b);
    if (a !== b && !Object.hasOwn(legModes, mapped)) legModes[mapped] = mode;
  }

  const id = ctx.newId('trip');
  const trip: Trip = {
    id,
    title: field(receivedTripTitle(received.title)),
    startDate: field(received.startDate),
    endDate: field(received.endDate),
    origin: field(mineOrNull(received.originId)),
    candidates: field(candidates),
    days,
    legModes: field(legModes),
    createdAt: ctx.now,
    deletedAt: null,
  };

  // 문서가 읽기 검사를 통과했다면 여기서 걸릴 일은 없다. 그래도 잘못된 보관함은 만들지 않는다.
  if (checkTrip(trip, placed.lib.places, ['trips', id]).length > 0) {
    const span = daysBetween(received.startDate, received.endDate);
    return {
      ok: false,
      error: { _tag: 'TripDatesInvalid', reason: span < 1 ? 'order' : 'too-many-days' },
    };
  }
  return {
    ok: true,
    lib: { ...placed.lib, trips: { ...placed.lib.trips, [id]: trip } },
    createdId: id,
    summary: placed.summary,
  };
}
