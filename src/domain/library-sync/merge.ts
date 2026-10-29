import { pickField, type Field } from 'src/domain/library/lww';
import { checkMeeting, type Meeting } from 'src/schema/meeting';
import { checkTrip, type Day, type Trip } from 'src/schema/trip';
import {
  isDeleted,
  lastTouched,
  stableStringify,
  tripRefs,
  type AnyItem,
  type ItemDocOf,
  type ItemKind,
} from './items';

export type Loser = { path: string; side: 'a' | 'b'; value: unknown; updatedAt: string };
export type MergeResult<T> = { doc: T; losers: Loser[]; whole?: 'a' | 'b' };

export function mergeDeletion(a: AnyItem, b: AnyItem, baseDeleted?: boolean): string | null {
  const aDeleted = isDeleted(a);
  const bDeleted = isDeleted(b);
  if (aDeleted === bDeleted) {
    if (!aDeleted) return null;
    return a.deletedAt! >= b.deletedAt! ? a.deletedAt : b.deletedAt;
  }
  if (baseDeleted !== undefined) return aDeleted !== baseDeleted ? a.deletedAt : b.deletedAt;
  const tombstone = aDeleted ? a : b;
  const live = aDeleted ? b : a;
  return tombstone.deletedAt! >= lastTouched(live) ? tombstone.deletedAt : null;
}

function isField(value: unknown): value is Field<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.hasOwn(value, 'value') &&
    Object.hasOwn(value, 'updatedAt')
  );
}

/** 입력의 키 순서를 유지하고 한쪽에만 있는 선택 필드도 남긴다. */
function orderDoc<T extends AnyItem>(a: T, doc: T): T {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(doc)])];
  return Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(doc, key))
      .map((key) => [key, (doc as Record<string, unknown>)[key]]),
  ) as T;
}

function dateSide(a: Trip, b: Trip): 'a' | 'b' {
  const at =
    a.startDate.updatedAt > a.endDate.updatedAt ? a.startDate.updatedAt : a.endDate.updatedAt;
  const bt =
    b.startDate.updatedAt > b.endDate.updatedAt ? b.startDate.updatedAt : b.endDate.updatedAt;
  if (at !== bt) return at > bt ? 'a' : 'b';
  return stableStringify([a.startDate, a.endDate, a.days.length]) >=
    stableStringify([b.startDate, b.endDate, b.days.length])
    ? 'a'
    : 'b';
}

function dayValues(days: readonly Day[]): unknown {
  return days.map((day) => ({
    stops: day.stops.value,
    lodging: day.lodging.value,
    startTime: day.startTime.value,
  }));
}

function daysTouched(days: readonly Day[], fallback: string): string {
  return days.reduce(
    (latest, day) =>
      [day.stops.updatedAt, day.lodging.updatedAt, day.startTime.updatedAt, latest].sort().at(-1)!,
    fallback,
  );
}

export function mergeItem<K extends ItemKind>(
  kind: K,
  a: ItemDocOf[K],
  b: ItemDocOf[K],
  opts?: { baseDeleted?: boolean },
): MergeResult<ItemDocOf[K]> {
  const losers: Loser[] = [];
  const chooseField = <T>(path: string, af: Field<T>, bf: Field<T>, side?: 'a' | 'b'): Field<T> => {
    const winner = side === undefined ? pickField(af, bf) : side === 'a' ? af : bf;
    const loserSide = winner === af ? 'b' : 'a';
    const loser = loserSide === 'a' ? af : bf;
    if (stableStringify(winner.value) !== stableStringify(loser.value)) {
      losers.push({ path, side: loserSide, value: loser.value, updatedAt: loser.updatedAt });
    }
    return winner;
  };

  const ar = a as Record<string, unknown>;
  const br = b as Record<string, unknown>;
  const result: Record<string, unknown> = { ...ar };
  for (const key of new Set([...Object.keys(ar), ...Object.keys(br)])) {
    if (kind === 'trip' && (key === 'startDate' || key === 'endDate' || key === 'days')) continue;
    const af = ar[key];
    const bf = br[key];
    if (isField(af) && isField(bf)) result[key] = chooseField(key, af, bf);
    else if (isField(bf)) result[key] = bf;
  }
  result.createdAt = a.createdAt <= b.createdAt ? a.createdAt : b.createdAt;
  result.deletedAt = mergeDeletion(a, b, opts?.baseDeleted);

  if (kind === 'place') {
    const immutable = (doc: Record<string, unknown>) =>
      stableStringify([doc.source, doc.address, doc.lng, doc.lat]);
    const aValue = immutable(ar);
    const bValue = immutable(br);
    const winner =
      aValue === bValue ||
      a.createdAt < b.createdAt ||
      (a.createdAt === b.createdAt && aValue >= bValue)
        ? ar
        : br;
    for (const key of ['source', 'address', 'lng', 'lat']) result[key] = winner[key];
  }
  if (kind === 'folder') {
    result.checkedAt =
      (ar.checkedAt as string) >= (br.checkedAt as string) ? ar.checkedAt : br.checkedAt;
  }
  if (kind === 'trip') {
    const at = a as Trip;
    const bt = b as Trip;
    const side = dateSide(at, bt);
    const dateWinner = side === 'a' ? at : bt;
    result.startDate = chooseField('startDate', at.startDate, bt.startDate, side);
    result.endDate = chooseField('endDate', at.endDate, bt.endDate, side);
    if (at.days.length === bt.days.length) {
      result.days = at.days.map((day, i) => {
        const other = bt.days[i]!;
        return {
          stops: chooseField(`days.${i}.stops`, day.stops, other.stops),
          lodging: chooseField(`days.${i}.lodging`, day.lodging, other.lodging),
          startTime: chooseField(`days.${i}.startTime`, day.startTime, other.startTime),
        };
      });
    } else {
      result.days = dateWinner.days;
      const loser = side === 'a' ? bt : at;
      if (stableStringify(dayValues(loser.days)) !== stableStringify(dayValues(dateWinner.days))) {
        losers.push({
          path: 'days',
          side: side === 'a' ? 'b' : 'a',
          value: loser.days,
          updatedAt: daysTouched(loser.days, loser.createdAt),
        });
      }
    }
  }

  let doc = orderDoc(a, result as ItemDocOf[K]);
  const invalid =
    kind === 'trip'
      ? checkTrip(
          doc as Trip,
          Object.fromEntries(tripRefs(doc as Trip).map((id) => [id, true])),
          [],
        ).length > 0
      : kind === 'meeting' && checkMeeting(doc as Meeting, []).length > 0;
  if (invalid) {
    const at = lastTouched(a);
    const bt = lastTouched(b);
    const winner = at > bt || (at === bt && stableStringify(a) >= stableStringify(b)) ? 'a' : 'b';
    doc = orderDoc(a, { ...(winner === 'a' ? a : b), deletedAt: result.deletedAt } as ItemDocOf[K]);
    return { doc, losers: [], whole: winner === 'a' ? 'b' : 'a' };
  }
  return { doc, losers };
}
