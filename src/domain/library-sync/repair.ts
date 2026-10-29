import { setField } from 'src/domain/library/lww';
import { mergeLabels, type OpCtx } from 'src/domain/library/ops';
import { normalizeLabelName, type Library, type Place } from 'src/schema/library';
import { putItems } from './items';
import { mergeItem } from './merge';

function sourceKey(p: Place): string | null {
  const s = p.source;
  if (s.kind === 'naver') return `naver:${s.sid}`;
  if (s.kind === 'kakao') return `kakao:${s.kakaoId}`;
  if (s.kind === 'google') return `google:${s.googleId}`;
  return s.legacy ? `legacy:${s.legacy.publicId}/${s.legacy.placeKey}` : null;
}
const earlier = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) =>
  a.createdAt < b.createdAt
    ? -1
    : a.createdAt > b.createdAt
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;

/** 중복의 생존자를 입력 순서와 무관하게 고른다. */
export function repairLibrary(lib: Library, ctx: OpCtx): Library {
  let next = lib;
  const names = new Map<string, string>();
  for (const label of Object.values(lib.labels)
    .filter((l) => l.deletedAt === null)
    .sort(earlier)) {
    const name = normalizeLabelName(label.name.value);
    const survivor = names.get(name);
    if (survivor) next = mergeLabels(next, label.id, survivor, ctx);
    else names.set(name, label.id);
  }
  const sources = new Map<string, string>();
  for (const original of Object.values(next.places)
    .filter((p) => p.deletedAt === null)
    .sort(earlier)) {
    const p = next.places[original.id]!;
    const key = sourceKey(p);
    if (!key) continue;
    const id = sources.get(key);
    if (!id) {
      sources.set(key, p.id);
      continue;
    }
    const survivor = next.places[id]!;
    const merged = mergeItem('place', survivor, p).doc;
    const labelIds = {
      value: [...new Set([...survivor.labelIds.value, ...p.labelIds.value])],
      updatedAt:
        survivor.labelIds.updatedAt > p.labelIds.updatedAt
          ? survivor.labelIds.updatedAt
          : p.labelIds.updatedAt,
    };
    next = putItems(next, [
      { kind: 'place', id, doc: { ...merged, id, labelIds } },
      { kind: 'place', id: p.id, doc: { ...p, deletedAt: ctx.now } },
    ]);
    for (const trip of Object.values(next.trips)) {
      const present =
        trip.candidates.value.includes(id) ||
        trip.days.some((d) => d.stops.value.some((s) => s.placeId === id));
      const candidates =
        !present && trip.candidates.value.includes(p.id)
          ? setField(
              trip.candidates,
              trip.candidates.value.map((x) => (x === p.id ? id : x)),
              ctx.now,
            )
          : trip.candidates;
      const origin = trip.origin.value === p.id ? setField(trip.origin, id, ctx.now) : trip.origin;
      const days = trip.days.map((d) => ({
        ...d,
        stops:
          !present && d.stops.value.some((s) => s.placeId === p.id)
            ? setField(
                d.stops,
                d.stops.value.map((s) => (s.placeId === p.id ? { ...s, placeId: id } : s)),
                ctx.now,
              )
            : d.stops,
        lodging: d.lodging.value === p.id ? setField(d.lodging, id, ctx.now) : d.lodging,
      }));
      if (
        origin !== trip.origin ||
        candidates !== trip.candidates ||
        days.some((d, i) => d.stops !== trip.days[i]!.stops || d.lodging !== trip.days[i]!.lodging)
      )
        next = putItems(next, [
          { kind: 'trip', id: trip.id, doc: { ...trip, origin, candidates, days } },
        ]);
    }
  }
  for (const p of Object.values(next.places)) {
    if (p.deletedAt !== null) continue;
    const ids = p.labelIds.value.filter((id) => next.labels[id]?.deletedAt === null);
    if (ids.length !== p.labelIds.value.length)
      next = putItems(next, [
        { kind: 'place', id: p.id, doc: { ...p, labelIds: setField(p.labelIds, ids, ctx.now) } },
      ]);
  }
  for (const folder of Object.values(next.folders ?? {})) {
    if (folder.deletedAt === null && next.labels[folder.labelId.value]?.deletedAt !== null)
      next = putItems(next, [
        { kind: 'folder', id: folder.shareId, doc: { ...folder, deletedAt: ctx.now } },
      ]);
  }
  return next;
}
