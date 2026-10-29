import { daysBetween } from '../../lib/calendar';
import { checkPlan, NEW_DAY_START, type CollabDay, type CollabPlan, type CollabStop } from './plan';

export type CollabSide = 'mine' | 'theirs';
export type ListId = 'c' | `d${number}`;
export type FieldConflict = {
  kind: 'field';
  id: string;
  field:
    'title' | 'origin' | 'startTime' | 'lodging' | 'legMode' | 'stayMin' | 'fixedTime' | 'note';
  dayIndex?: number;
  stopId?: string;
  placeId?: string;
  legKey?: string;
  mine: unknown;
  theirs: unknown;
};
export type PlacementSide = {
  period: { startDate: string; endDate: string };
  lists: Partial<Record<ListId, string[]>>;
};
export type PlacementConflict = {
  kind: 'placement';
  id: string;
  lists: ListId[];
  period: boolean;
  mine: PlacementSide;
  theirs: PlacementSide;
};
export type CollabConflict = FieldConflict | PlacementConflict;
export type CollabMerge = {
  base: CollabPlan | null;
  mine: CollabPlan;
  theirs: CollabPlan;
  conflicts: CollabConflict[];
  plan: CollabPlan | null;
};
export type ResolveResult =
  | { ok: true; plan: CollabPlan }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'invalid'; merge: CollabMerge };
export function compareListIds(a: ListId, b: ListId): number {
  return a === b ? 0 : a === 'c' ? -1 : b === 'c' ? 1 : Number(a.slice(1)) - Number(b.slice(1));
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function pick<T>(
  base: T | undefined,
  mine: T,
  theirs: T,
  hasBase: boolean,
): { value: T; conflict: boolean } {
  if (hasBase && equal(mine, base)) return { value: theirs, conflict: false };
  if (equal(mine, theirs) || (hasBase && equal(theirs, base)))
    return { value: mine, conflict: false };
  return { value: mine, conflict: true };
}
const periodOf = (p: CollabPlan) => ({ startDate: p.startDate, endDate: p.endDate });
const listOf = (p: CollabPlan | null, id: ListId): string[] | undefined =>
  p === null
    ? undefined
    : id === 'c'
      ? p.candidates
      : p.days[Number(id.slice(1))]?.stops.map((s) => s.placeId);
const stopsOf = (p: CollabPlan | null) =>
  new Map(p?.days.flatMap((d) => d.stops.map((s) => [s.id, s] as const)) ?? []);
function locations(p: CollabPlan | null): Map<string, ListId> {
  return new Map(
    p
      ? [
          ...p.candidates.map((s) => [s, 'c'] as const),
          ...p.days.flatMap((d, i) => d.stops.map((s) => [s.placeId, `d${i}` as ListId] as const)),
        ]
      : [],
  );
}
function sideOf(p: CollabPlan, lists: ListId[]): PlacementSide {
  return {
    period: periodOf(p),
    lists: Object.fromEntries(
      lists.flatMap((id) => {
        const row = listOf(p, id);
        return row === undefined ? [] : [[id, [...row]]];
      }),
    ),
  };
}
function allPlacement(mine: CollabPlan, theirs: CollabPlan, lists: ListId[]): PlacementConflict {
  return {
    kind: 'placement',
    id: 'placement.all',
    lists,
    period: true,
    mine: sideOf(mine, lists),
    theirs: sideOf(theirs, lists),
  };
}

/** 값과 장소 이동을 따로 검사하고 이어진 배치만 함께 고른다. */
function analyze(
  base: CollabPlan | null,
  mine: CollabPlan,
  theirs: CollabPlan,
  choices: Readonly<Record<string, CollabSide>>,
  forceAll = false,
): { plan: CollabPlan; conflicts: CollabConflict[]; all: PlacementConflict } {
  const count = Math.max(base?.days.length ?? 0, mine.days.length, theirs.days.length);
  const lists: ListId[] = ['c', ...Array.from({ length: count }, (_, i) => `d${i}` as ListId)];
  const all = allPlacement(mine, theirs, lists);
  const period = pick(
    base ? periodOf(base) : undefined,
    periodOf(mine),
    periodOf(theirs),
    base !== null,
  );
  const values = new Map(
    lists.map((id) => [
      id,
      pick(listOf(base, id), listOf(mine, id), listOf(theirs, id), base !== null),
    ]),
  );
  type Node = ListId | 'period';
  const groups: Set<Node>[] = [];
  function link(nodes: (Node | null | undefined)[]): void {
    const group = new Set(nodes.filter((n): n is Node => n != null));
    if (!group.size) return;
    for (let i = groups.length - 1; i >= 0; i--)
      if ([...groups[i]!].some((n) => group.has(n))) {
        for (const n of groups.splice(i, 1)[0]!) group.add(n);
      }
    groups.push(group);
  }
  const bLoc = locations(base),
    mLoc = locations(mine),
    tLoc = locations(theirs);
  const places = new Set([...bLoc.keys(), ...mLoc.keys(), ...tLoc.keys()]);
  const bStops = stopsOf(base),
    mStops = stopsOf(mine),
    tStops = stopsOf(theirs);
  if (forceAll) link(['period', ...lists]);
  else if (!base) {
    const different = lists.filter((id) => !equal(listOf(mine, id), listOf(theirs, id)));
    link([...different, ...(period.conflict ? ['period' as const, 'c' as const] : [])]);
  } else {
    for (const id of lists) if (values.get(id)!.conflict) link([id]);
    for (const p of places)
      if (pick(bLoc.get(p) ?? null, mLoc.get(p) ?? null, tLoc.get(p) ?? null, true).conflict)
        link([bLoc.get(p), mLoc.get(p), tLoc.get(p)]);
    for (const [id, stop] of bStops) {
      const m = mStops.get(id),
        t = tStops.get(id);
      const changed = (s: CollabStop) =>
        ['stayMin', 'fixedTime', 'note'].some(
          (key) => !equal(s[key as keyof CollabStop], stop[key as keyof CollabStop]),
        );
      if ((!m && t && changed(t)) || (!t && m && changed(m)))
        link([bLoc.get(stop.placeId), mLoc.get(stop.placeId), tLoc.get(stop.placeId)]);
    }
    if (period.conflict)
      link([
        'period',
        'c',
        ...lists.filter(
          (id) =>
            id !== 'c' && Number(id.slice(1)) >= Math.min(mine.days.length, theirs.days.length),
        ),
      ]);
    else {
      const n = daysBetween(period.value.startDate, period.value.endDate);
      for (const other of [mine, theirs]) {
        if (other.days.length <= n) continue;
        const cut = lists.filter(
          (id) =>
            id !== 'c' &&
            Number(id.slice(1)) >= n &&
            (listOf(base, id) === undefined
              ? (listOf(other, id)?.length ?? 0) > 0
              : !equal(listOf(base, id), listOf(other, id))),
        );
        if (cut.length) link(['period', 'c', ...cut]);
      }
    }
    // 장소가 오간 목록은 이미 겹친 묶음과 연결될 때 함께 묶는다.
    let previous = '';
    while (previous !== JSON.stringify(groups.map((g) => [...g].sort()).sort())) {
      previous = JSON.stringify(groups.map((g) => [...g].sort()).sort());
      for (const p of places) {
        const m = mLoc.get(p),
          t = tLoc.get(p),
          nodes = [bLoc.get(p), m, t];
        if (m !== t && groups.some((g) => nodes.some((n) => n != null && g.has(n)))) link(nodes);
      }
    }
  }
  const placements: PlacementConflict[] = forceAll
    ? [all]
    : groups
        .map((g): PlacementConflict => {
          const row = [...g].filter((n): n is ListId => n !== 'period').sort(compareListIds);
          const hasPeriod = g.has('period');
          return {
            kind: 'placement',
            id: `placement.${hasPeriod ? 'period,' : ''}${row.join(',')}`,
            lists: row,
            period: hasPeriod,
            mine: sideOf(mine, row),
            theirs: sideOf(theirs, row),
          };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
  let chosenPeriod = period.value;
  const chosenLists = new Map<ListId, { value: string[] | undefined; source: CollabPlan }>();
  for (const id of lists) {
    const value = values.get(id)!.value;
    chosenLists.set(id, { value, source: equal(value, listOf(theirs, id)) ? theirs : mine });
  }
  for (const c of placements) {
    const source = choices[c.id] === 'theirs' ? theirs : mine;
    if (c.period) chosenPeriod = periodOf(source);
    for (const id of c.lists) chosenLists.set(id, { value: listOf(source, id), source });
  }
  const fields: FieldConflict[] = [];
  function field<T>(
    info: Omit<FieldConflict, 'kind' | 'mine' | 'theirs'>,
    b: T | undefined,
    m: T,
    t: T,
  ): T {
    const result = pick(b, m, t, base !== null);
    if (!result.conflict) return result.value;
    fields.push({ kind: 'field', ...info, mine: m, theirs: t });
    return choices[info.id] === 'theirs' ? t : m;
  }
  const title = field({ id: 'title', field: 'title' }, base?.title, mine.title, theirs.title);
  const origin = field({ id: 'origin', field: 'origin' }, base?.origin, mine.origin, theirs.origin);
  const legModes: CollabPlan['legModes'] = {};
  for (const key of [
    ...new Set([
      ...Object.keys(base?.legModes ?? {}),
      ...Object.keys(mine.legModes),
      ...Object.keys(theirs.legModes),
    ]),
  ].sort()) {
    const mode = field(
      { id: `legMode.${key}`, field: 'legMode', legKey: key },
      base?.legModes[key],
      mine.legModes[key],
      theirs.legModes[key],
    );
    if (mode !== undefined) legModes[key] = mode;
  }
  const days: CollabDay[] = [];
  const span = daysBetween(chosenPeriod.startDate, chosenPeriod.endDate);
  for (let i = 0; i < Math.min(30, Math.max(0, span)); i++) {
    const b = base?.days[i],
      m = mine.days[i],
      t = theirs.days[i];
    const dayField = <K extends 'startTime' | 'lodging'>(key: K): CollabDay[K] => {
      if (!m || !t)
        return (m ?? t)?.[key] ?? ((key === 'startTime' ? NEW_DAY_START : null) as CollabDay[K]);
      return field(
        { id: `day.${i}.${key}`, field: key, dayIndex: i },
        b?.[key] ?? ((key === 'startTime' ? NEW_DAY_START : null) as CollabDay[K]),
        m[key],
        t[key],
      );
    };
    const row = chosenLists.get(`d${i}`)!;
    const sourceStops = row.source.days[i]?.stops ?? [];
    const stops = (row.value ?? []).map((placeId) => {
      const stop = sourceStops.find((s) => s.placeId === placeId)!;
      const ms = mStops.get(stop.id),
        ts = tStops.get(stop.id),
        bs = bStops.get(stop.id);
      if (!ms || !ts) return { ...stop };
      return {
        ...stop,
        ...Object.fromEntries(
          (['stayMin', 'fixedTime', 'note'] as const).map((key) => [
            key,
            field(
              { id: `stop.${stop.id}.${key}`, field: key, stopId: stop.id, placeId },
              bs?.[key],
              ms[key],
              ts[key],
            ),
          ]),
        ),
      };
    });
    days.push({
      id: (t ?? m)?.id ?? '',
      startTime: dayField('startTime'),
      lodging: dayField('lodging'),
      stops,
    });
  }
  return {
    plan: {
      title,
      ...chosenPeriod,
      origin,
      candidates: [...(chosenLists.get('c')!.value ?? [])],
      legModes,
      days,
    },
    conflicts: [...placements, ...fields].sort((a, b) => a.id.localeCompare(b.id)),
    all,
  };
}
export function mergeCollabPlan(
  base: CollabPlan | null,
  mine: CollabPlan,
  theirs: CollabPlan,
): CollabMerge {
  const result = analyze(base, mine, theirs, {});
  if (checkPlan(result.plan).length)
    return { base, mine, theirs, conflicts: [result.all], plan: null };
  return {
    base,
    mine,
    theirs,
    conflicts: result.conflicts,
    plan: result.conflicts.length ? null : result.plan,
  };
}
export function resolveCollabMerge(
  merge: CollabMerge,
  choices: Readonly<Record<string, CollabSide>>,
): ResolveResult {
  if (merge.conflicts.some((c) => choices[c.id] !== 'mine' && choices[c.id] !== 'theirs'))
    return { ok: false, reason: 'missing' };
  const result = analyze(
    merge.base,
    merge.mine,
    merge.theirs,
    choices,
    merge.conflicts.some((c) => c.id === 'placement.all'),
  );
  if (checkPlan(result.plan).length)
    return {
      ok: false,
      reason: 'invalid',
      merge: { ...merge, conflicts: [result.all], plan: null },
    };
  return { ok: true, plan: result.plan };
}
