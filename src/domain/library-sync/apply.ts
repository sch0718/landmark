import type { OpCtx } from 'src/domain/library/ops';
import { LibrarySchema, type Library } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import {
  decodeItem,
  getItem,
  hashItem,
  isDeleted,
  itemKey,
  itemLabel,
  lastTouched,
  listItems,
  parseItemKey,
  putItems,
  removeItems,
  stableStringify,
  type AnyItem,
  type ItemKey,
  type ItemKind,
} from './items';
import { mergeItem, type MergeResult } from './merge';
import { repairLibrary } from './repair';
export type BaseEntry = { rev: number; hash: string; deleted: boolean };
export type BaseMap = Record<string, BaseEntry>;
export type RemoteItem = {
  kind: ItemKind;
  id: string;
  rev: number;
  deleted: boolean;
  doc: unknown;
};
export type Conflict = {
  id: string;
  key: ItemKey;
  kind: ItemKind;
  label: string;
  path: string;
  mine: unknown;
  theirs: unknown;
  at: string;
  whole?: true;
  deleted?: true;
};
export type HeldItem = { key: ItemKey; rev: number; reason: 'decode' | 'library' };
export type ApplyOptions = {
  ctx: OpCtx;
  lastSyncAt: string | null;
  fullResync: boolean;
  conflictId: () => string;
  skip?: ReadonlySet<string>;
};
export type ApplyResult = { lib: Library; base: BaseMap; conflicts: Conflict[]; held: HeldItem[] };
export type DirtyItem = {
  key: ItemKey;
  kind: ItemKind;
  id: string;
  doc: AnyItem;
  hash: string;
  baseRev: number;
  baseDeleted: boolean | null;
};
export type PushResultItem = { kind: ItemKind; id: string; rev: number; doc?: unknown };

export function dirtyItems(
  lib: Library,
  base: BaseMap,
  rejected: readonly { key: string; hash: string }[],
): DirtyItem[] {
  return listItems(lib).flatMap((entry) => {
    const hash = hashItem(entry.doc);
    const b = base[entry.key];
    return b?.hash === hash || rejected.some((r) => r.key === entry.key && r.hash === hash)
      ? []
      : [{ ...entry, hash, baseRev: b?.rev ?? 0, baseDeleted: b?.deleted ?? null }];
  });
}
export function missingFromLocal(lib: Library, base: BaseMap): boolean {
  return Object.keys(base).some((key) => {
    const p = parseItemKey(key);
    return p !== null && !getItem(lib, p.kind, p.id);
  });
}
function atPath(doc: AnyItem, path: string): unknown {
  let node: unknown = doc;
  for (const key of path.split('.')) node = (node as Record<string, unknown> | undefined)?.[key];
  return node && typeof node === 'object' && 'value' in node ? node.value : node;
}
function conflictsFor(
  kind: ItemKind,
  id: string,
  mine: AnyItem,
  result: MergeResult<AnyItem>,
  opts: ApplyOptions,
): Conflict[] {
  const since = opts.lastSyncAt;
  if (since === null) return [];
  const common = { key: itemKey(kind, id), kind, label: itemLabel(kind, mine), at: opts.ctx.now };
  if (!isDeleted(mine) && isDeleted(result.doc) && lastTouched(mine) > since)
    return [
      { ...common, id: opts.conflictId(), path: '', mine, theirs: result.doc, deleted: true },
    ];
  if (result.whole === 'a' && lastTouched(mine) > since)
    return [{ ...common, id: opts.conflictId(), path: '', mine, theirs: result.doc, whole: true }];
  return result.losers
    .filter((l) => l.side === 'a' && l.updatedAt > since)
    .map((l) => ({
      ...common,
      id: opts.conflictId(),
      path: l.path,
      mine: l.value,
      theirs: atPath(result.doc, l.path),
    }));
}
function finish(
  local: Library,
  originalBase: BaseMap,
  next: Library,
  base: BaseMap,
  remote: readonly RemoteItem[],
  conflicts: Conflict[],
  held: HeldItem[],
  opts: ApplyOptions,
): ApplyResult {
  const reverted = new Set<string>();
  for (let attempt = 0; attempt < 3; attempt++) {
    next = repairLibrary(next, opts.ctx);
    const parsed = safeParse(LibrarySchema, next);
    if (parsed.success) {
      const lib = stableStringify(local) === stableStringify(next) ? local : next;
      return { lib, base, conflicts: conflicts.filter((c) => !reverted.has(c.key)), held };
    }
    const kinds: Record<string, ItemKind> = {
      places: 'place',
      labels: 'label',
      folders: 'folder',
      trips: 'trip',
      meetings: 'meeting',
    };
    const keys = new Set<ItemKey>();
    for (const issue of parsed.issues) {
      const [collection, id] = issue.path.split('.');
      const kind = kinds[collection!];
      if (kind && id) keys.add(itemKey(kind, id));
    }
    if (!keys.size) break;
    for (const key of keys) {
      reverted.add(key);
      const p = parseItemKey(key)!;
      const old = getItem(local, p.kind, p.id);
      next = old ? putItems(next, [{ ...p, doc: old }]) : removeItems(next, [key]);
      if (originalBase[key]) base[key] = originalBase[key];
      else delete base[key];
      const r = remote.find((r) => itemKey(r.kind, r.id) === key);
      if (r && !held.some((h) => h.key === key)) held.push({ key, rev: r.rev, reason: 'library' });
    }
  }
  return {
    lib: local,
    base: { ...originalBase },
    conflicts: [],
    held: remote.map((r) => ({ key: itemKey(r.kind, r.id), rev: r.rev, reason: 'library' })),
  };
}
export function applyRemote(
  local: Library,
  base: BaseMap,
  remote: readonly RemoteItem[],
  opts: ApplyOptions,
): ApplyResult {
  let next = local;
  const nextBase = { ...base };
  const conflicts: Conflict[] = [];
  const held: HeldItem[] = [];
  for (const r of remote) {
    const key = itemKey(r.kind, r.id);
    const b = base[key];
    if (b && b.rev >= r.rev) continue;
    if (opts.skip?.has(key)) {
      nextBase[key] = { rev: r.rev, hash: hashItem(r.doc), deleted: r.deleted };
      continue;
    }
    const decoded = decodeItem(r.kind, r.id, r.doc);
    if (!decoded.ok) {
      held.push({ key, rev: r.rev, reason: 'decode' });
      continue;
    }
    const server = decoded.doc;
    const mine = getItem(next, r.kind, r.id);
    if (!opts.skip?.has(key)) {
      let doc = server;
      if (mine && (!b || hashItem(mine) !== b.hash)) {
        const result = mergeItem(r.kind, mine, server, { baseDeleted: b?.deleted });
        doc = result.doc;
        conflicts.push(...conflictsFor(r.kind, r.id, mine, result, opts));
      }
      next = putItems(next, [{ kind: r.kind, id: r.id, doc }]);
    }
    nextBase[key] = { rev: r.rev, hash: hashItem(server), deleted: isDeleted(server) };
  }
  if (opts.fullResync) {
    const received = new Set(remote.map((r) => itemKey(r.kind, r.id)));
    for (const key of Object.keys(base)) {
      if (received.has(key as ItemKey)) continue;
      const p = parseItemKey(key);
      if (!p) continue;
      const mine = getItem(next, p.kind, p.id);
      if (!mine) {
        delete nextBase[key];
        continue;
      }
      const doc = isDeleted(mine) ? mine : { ...mine, deletedAt: opts.ctx.now };
      if (doc !== mine)
        conflicts.push(...conflictsFor(p.kind, p.id, mine, { doc, losers: [] }, opts));
      next = putItems(next, [{ ...p, doc }]);
      nextBase[key] = { rev: 0, hash: hashItem(doc), deleted: true };
    }
  }
  return finish(local, base, next, nextBase, remote, conflicts, held, opts);
}
export function applyPushResults(
  local: Library,
  base: BaseMap,
  sent: readonly DirtyItem[],
  results: readonly PushResultItem[],
  opts: ApplyOptions,
): ApplyResult {
  let next = local;
  const nextBase = { ...base };
  const conflicts: Conflict[] = [];
  const held: HeldItem[] = [];
  const remote: RemoteItem[] = [];
  for (const r of results) {
    const key = itemKey(r.kind, r.id);
    const upload = sent.find((s) => s.key === key);
    if (!upload) continue;
    const decoded = decodeItem(r.kind, r.id, r.doc ?? upload.doc);
    if (!decoded.ok) {
      held.push({ key, rev: r.rev, reason: 'decode' });
      continue;
    }
    const server = decoded.doc;
    const mine = getItem(next, r.kind, r.id);
    let doc = server;
    if (mine && hashItem(mine) !== upload.hash) {
      const result = mergeItem(r.kind, mine, server, { baseDeleted: isDeleted(upload.doc) });
      doc = result.doc;
      conflicts.push(...conflictsFor(r.kind, r.id, mine, result, opts));
    }
    next = putItems(next, [{ kind: r.kind, id: r.id, doc }]);
    nextBase[key] = { rev: r.rev, hash: hashItem(server), deleted: isDeleted(server) };
    remote.push({ ...r, doc: server, deleted: isDeleted(server) });
  }
  return finish(local, base, next, nextBase, remote, conflicts, held, opts);
}
