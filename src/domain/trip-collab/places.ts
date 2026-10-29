import { importSharePlaces } from '../library/import-share';
import { setField } from '../library/lww';
import type { OpCtx, OpError, OpResult } from '../library/ops';
import type { Library, Place } from '../../schema/library';
import type { Trip } from '../../schema/trip';
import type { SharePlace } from '../../schema/share';
import type { LiveTripDoc } from '../trip-live/live-doc';
import type { CollabPlan } from './plan';

export type PlaceMap = Readonly<Record<string, string>>;
export function sameSource(place: Place, shared: SharePlace): boolean {
  const s = place.source;
  if (s.kind === 'naver') return s.sid === shared.naverSid;
  if (s.kind === 'kakao') return s.kakaoId === shared.kakaoId;
  if (s.kind === 'google') return s.googleId === shared.googleId;
  return (
    shared.naverSid === undefined &&
    shared.kakaoId === undefined &&
    shared.googleId === undefined &&
    Math.abs(place.lng - shared.lng) < 1e-7 &&
    Math.abs(place.lat - shared.lat) < 1e-7
  );
}
export function mapServerPlaces(
  lib: Library,
  doc: LiveTripDoc,
  placeMap: PlaceMap,
  ctx: OpCtx,
): { ok: true; lib: Library; placeMap: Record<string, string> } | { ok: false; error: OpError } {
  let work = lib;
  const mapped = { ...placeMap },
    selected: string[] = [];
  for (const shared of doc.share.places) {
    const known = mapped[shared.id];
    if (known && Object.hasOwn(work.places, known)) continue;
    const p = work.places[shared.id];
    if (p && sameSource(p, shared)) {
      mapped[shared.id] = shared.id;
      if (p.deletedAt !== null)
        work = { ...work, places: { ...work.places, [p.id]: { ...p, deletedAt: null } } };
    } else selected.push(shared.id);
  }
  if (selected.length) {
    const r = importSharePlaces(
      work,
      doc.share,
      { selected, titleLabel: null, appendMemo: false },
      ctx,
    );
    if (!r.ok) return r;
    work = r.lib;
    for (const [server, local] of r.placeIds) mapped[server] = local;
  }
  return { ok: true, lib: work, placeMap: mapped };
}
export function assignServerPlaceIds(
  trip: Trip,
  placeMap: PlaceMap,
  taken: ReadonlySet<string>,
  newId: () => string,
): Record<string, string> {
  const result = { ...placeMap },
    known = new Set(Object.values(placeMap)),
    used = new Set([...taken, ...Object.keys(placeMap)]);
  const refs = [
    trip.origin.value,
    ...trip.candidates.value,
    ...trip.days.flatMap((d) => [...d.stops.value.map((s) => s.placeId), d.lodging.value]),
  ];
  for (const id of refs) {
    if (id === null || known.has(id)) continue;
    let server = id;
    while (used.has(server)) server = newId();
    result[server] = id;
    known.add(id);
    used.add(server);
  }
  return result;
}
export function serverIdOf(placeMap: PlaceMap): (localId: string) => string {
  const reverse = new Map<string, string>();
  for (const [s, l] of Object.entries(placeMap)) if (!reverse.has(l)) reverse.set(l, s);
  return (id) => {
    const server = reverse.get(id);
    if (server === undefined) throw new Error(`대응이 없는 장소: ${id}`);
    return server;
  };
}
export function stopIdClashes(
  mine: CollabPlan,
  theirs: CollabPlan,
  base: CollabPlan | null,
): string[] {
  const before = new Set(base?.days.flatMap((d) => d.stops.map((s) => s.id)) ?? []);
  const other = new Map(theirs.days.flatMap((d) => d.stops.map((s) => [s.id, s.placeId] as const)));
  return mine.days.flatMap((d) =>
    d.stops
      .filter((s) => !before.has(s.id) && other.has(s.id) && other.get(s.id) !== s.placeId)
      .map((s) => s.id),
  );
}
export function renameStopIds(
  lib: Library,
  tripId: string,
  ids: readonly string[],
  ctx: OpCtx,
): OpResult {
  const trip = lib.trips[tripId];
  if (!trip || trip.deletedAt !== null)
    return { ok: false, error: { _tag: 'NotFound', id: tripId } };
  const wanted = new Set(ids),
    used = new Set(trip.days.flatMap((d) => d.stops.value.map((s) => s.id)));
  let changed = false;
  const days = trip.days.map((d) => {
    const next = d.stops.value.map((s) => {
      if (!wanted.has(s.id)) return s;
      let id: string;
      do {
        id = ctx.newId('stop');
      } while (used.has(id));
      used.add(id);
      return { ...s, id };
    });
    const stops = setField(d.stops, next, ctx.now);
    if (stops === d.stops) return d;
    changed = true;
    return { ...d, stops };
  });
  return {
    ok: true,
    lib: changed ? { ...lib, trips: { ...lib.trips, [tripId]: { ...trip, days } } } : lib,
  };
}
