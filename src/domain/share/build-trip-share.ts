import { fixedLegTime } from 'src/domain/trips/leg-time';
import { toShareLabels, toSharePlace } from 'src/domain/share/build-share';
import { SHARE_TRIP_LIMITS } from 'src/domain/share/check-share-trip';
import {
  dayEndpoints,
  dayLegs,
  visibleCandidates,
  visibleStops,
  type Leg,
} from 'src/domain/trips/query';
import type { Library } from 'src/schema/library';
import type {
  ShareDay,
  ShareTripDoc,
  ShareLeg,
  SharePlace,
  ShareStop,
  ShareTrip,
} from 'src/schema/share';

/** 창의 `routeOf`가 구간마다 돌려주는 시간·거리·상태·경로선. */
export type ShareLegTime = Pick<
  ShareLeg,
  'durationS' | 'distanceM' | 'tollFare' | 'status' | 'queriedAt' | 'path'
>;

export type BuildTripShareOptions = {
  title: string;
  includeMemo: boolean;
  includeCandidates: boolean;
  now: Date;
};

/**
 * 보관함의 여행 하나로 v2·v3 공유 문서를 만든다(스펙 §3.3). 여행이 없거나 지웠으면 null.
 *
 * - 장소 순서: 출발지 → Day마다 [Stop → 숙소] → 후보. 같은 장소는 처음 나온 자리 하나만.
 *   지운 장소(묘비)는 빠지고, 지운 출발지·숙소는 `null`이다(계획 화면의 `dayEndpoints` 규칙).
 * - 구간은 `dayLegs`와 같은 순서이며 시간·경로는 `routeOf`가 준 값을 그대로 쓴다.
 *   다만 `routed`가 아니면 `path: []`·`queriedAt: null`로 맞추고, 경로선 점이 문서 전체 한도를
 *   넘으면 `thinPaths`로 솎는다.
 */
export function buildTripShareDoc(
  lib: Library,
  tripId: string,
  routeOf: (leg: Leg) => ShareLegTime,
  opts: BuildTripShareOptions,
): ShareTripDoc | null {
  const trip = lib.trips[tripId];
  if (trip === undefined || trip.deletedAt !== null) return null;

  // 문서에 담는 장소 id를 처음 나온 순서로 모은다.
  const order: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | null) => {
    if (id === null || seen.has(id)) return;
    seen.add(id);
    order.push(id);
  };

  const candidates = opts.includeCandidates ? visibleCandidates(lib, trip) : [];
  const days: ShareDay[] = trip.days.map((day, di) => {
    const { start, end } = dayEndpoints(lib, trip, di);
    if (di === 0) add(start?.id ?? null);
    const stops: ShareStop[] = visibleStops(lib, day).map((stop) => {
      add(stop.placeId);
      const out: ShareStop = {
        placeId: stop.placeId,
        stayMin: stop.stayMin,
        fixedTime: stop.fixedTime,
      };
      if (stop.note !== '') out.note = stop.note;
      return out;
    });
    add(end?.id ?? null);

    const legs = dayLegs(lib, trip, di).map((leg) =>
      toShareLeg(
        leg,
        (leg.minutes !== null || leg.mode === 'transit' ? fixedLegTime(leg) : null) ?? routeOf(leg),
      ),
    );
    return { startTime: day.startTime.value, lodgingId: end?.id ?? null, stops, legs };
  });
  for (const place of candidates) add(place.id);

  const places: SharePlace[] = [];
  const usedLabelIds = new Set<string>();
  for (const id of order) {
    const out = toSharePlace(lib.places[id]!, lib, opts.includeMemo, true);
    for (const labelId of out.labelIds) usedLabelIds.add(labelId);
    places.push(out);
  }

  // 사람이 고른 이동 수단 가운데 문서에 담긴 두 장소 사이의 것만.
  const legModes: ShareTrip['legModes'] = {};
  for (const [key, mode] of Object.entries(trip.legModes.value)) {
    const parts = key.split('>');
    if (parts.length === 2 && seen.has(parts[0]!) && seen.has(parts[1]!)) legModes[key] = mode;
  }

  // 대중교통·직접 입력 시간은 지금 이웃한 구간의 것만 담는다. 순서가 바뀌어 쓰이지 않는 옛 키로
  // 문서가 v3가 되면 옛 버전이 가져오기를 거절한다.
  const legKeys = new Set(trip.days.flatMap((_, di) => dayLegs(lib, trip, di).map((l) => l.key)));
  const retained = (key: string) => legKeys.has(key);
  for (const key of trip.legTransit?.value ?? []) {
    if (retained(key)) legModes[key] = 'transit';
  }
  const legMinutes = Object.fromEntries(
    Object.entries(trip.legMinutes?.value ?? {}).filter(([key]) => retained(key)),
  );
  const shareTrip: ShareTrip = {
    title: trip.title.value,
    startDate: trip.startDate.value,
    endDate: trip.endDate.value,
    originId: dayEndpoints(lib, trip, 0).start?.id ?? null,
    candidateIds: candidates.map((place) => place.id),
    days: thinPaths(days, SHARE_TRIP_LIMITS.pathPointsTotal),
    legModes,
    ...(Object.keys(legMinutes).length > 0 ? { legMinutes } : {}),
  };

  return {
    format: 'tripmap-share',
    version:
      Object.values(legModes).includes('transit') || Object.keys(legMinutes).length > 0 ? 3 : 2,
    title: opts.title.trim(),
    createdAt: opts.now.toISOString(),
    labels: toShareLabels(lib, usedLabelIds),
    places,
    trips: [shareTrip],
  };
}

function toShareLeg(leg: Leg, time: ShareLegTime): ShareLeg {
  const routed = time.status === 'routed';
  return {
    from: leg.from.id,
    to: leg.to.id,
    mode: leg.mode,
    durationS: time.durationS,
    distanceM: time.distanceM,
    tollFare: time.tollFare,
    status: time.status,
    queriedAt: routed ? time.queriedAt : null,
    path: routed ? time.path : [],
  };
}

/**
 * 문서 전체 경로선 점이 `max`를 넘으면 솎는다. 점이 2개 이상인 선은 첫·끝 점 2개를 먼저 남기고, 남는 예산을
 * 선마다 덜어 낼 수 있는 점 수(점 수 − 2)에 비례해 나눈다(나머지는 큰 몫부터 하나씩). 그래서 2점씩 남겨도
 * `max` 안에 들 수 있으면 결과는 `max` 이하이고, 그렇지 않으면 선마다 2점을 남긴다. 점이 2개 미만인 선은
 * 그대로 두며, 입력은 바꾸지 않는다.
 */
export function thinPaths(days: ShareDay[], max: number): ShareDay[] {
  const lines = days.flatMap((day) => day.legs.map((leg) => leg.path.length));
  const total = lines.reduce((a, n) => a + n, 0);
  if (total <= max) return days;

  // 2점 이상인 선의 덜어 낼 수 있는 점(n − 2)과, 첫·끝 점·짧은 선을 남긴 뒤의 예산.
  const spare = lines.map((n) => (n >= 2 ? n - 2 : 0));
  const spareTotal = spare.reduce((a, n) => a + n, 0);
  if (spareTotal === 0) return days; // 모든 선이 이미 2점 이하라 덜어 낼 점이 없다.
  const fixed = total - spareTotal;
  const budget = Math.max(0, max - fixed);

  // 큰 나머지 방식: 몫의 정수 부분을 주고, 남는 점은 나머지가 큰 선부터 하나씩(정수 계산).
  const extra = spare.map((e) => Math.floor((e * budget) / spareTotal));
  let left = budget - extra.reduce((a, n) => a + n, 0);
  const byRemainder = spare
    .map((e, i) => ({ i, r: (e * budget) % spareTotal }))
    .filter(({ r }) => r > 0)
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left === 0) break;
    extra[i]! += 1;
    left -= 1;
  }

  let at = 0;
  return days.map((day) => ({
    ...day,
    legs: day.legs.map((leg) => {
      const keep = 2 + extra[at++]!;
      return { ...leg, path: thinLine(leg.path, keep) };
    }),
  }));
}

/** 선의 점을 `keep`개로 고르게 솎는다(첫·끝 점은 남긴다). 점이 2개 미만이면 그대로. */
function thinLine(path: [number, number][], keep: number): [number, number][] {
  const n = path.length;
  if (n < 2 || keep >= n) return path;
  const out: [number, number][] = [];
  for (let i = 0; i < keep; i++) {
    out.push(path[Math.round((i * (n - 1)) / (keep - 1))]!);
  }
  return out;
}
