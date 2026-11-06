import {
  decodeItem,
  itemKey,
  itemLabel,
  ITEM_KINDS,
  tripRefs,
  type AnyItem,
  type ItemKind,
} from '../../domain/library-sync/items';
import { stampChangedFields } from '../../domain/library-sync/stamp';
import type { Trip } from '../../schema/trip';
import { idPattern, LIBRARY_QUOTA, pushItems, type PushItem } from '../library-sync/library';
import { SyncHttpError } from '../library-sync/http';
import type { MeetDb } from '../meet/db';
import { CHANGES_KEEP_MS, listRequestChanges, recordChanges, type ChangeRow } from './changes';

export const EDIT_MAX_OPS = 50;
/** 되돌리기 한 번에 처리하는 변경 수. 한 번의 pushItems로 묶어 50건이어도 D1 쿼리가 10개 안팎이다(Workers Free 호출당 50). */
export const UNDO_MAX_PER_CALL = 50;
const LABEL_MAX_CHARS = 80;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EditOp = {
  op: 'put' | 'delete';
  kind: ItemKind;
  id: string;
  baseRev: number;
  doc?: unknown;
};
export type EditBody = { v: 1; requestId: string; ops: EditOp[] };
export type EditStatus =
  'ok' | 'conflict' | 'missing' | 'referenced' | 'invalid-ref' | 'invalid' | 'too-large' | 'clock';
export type EditResult = {
  kind: ItemKind;
  id: string;
  status: EditStatus;
  rev?: number;
  doc?: unknown;
};
export type EditReply = { rev: number; results: EditResult[] };

function invalid(path: string): never {
  throw new SyncHttpError(422, 'invalid', { path });
}
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

export function parseEditBody(value: unknown): EditBody {
  if (!isRecord(value)) invalid('');
  if (Object.keys(value).some((k) => !['v', 'requestId', 'ops'].includes(k))) invalid('');
  if (value.v !== 1) invalid('v');
  if (typeof value.requestId !== 'string' || !uuidPattern.test(value.requestId))
    invalid('requestId');
  if (!Array.isArray(value.ops) || value.ops.length < 1 || value.ops.length > EDIT_MAX_OPS)
    invalid('ops');
  const seen = new Set<string>();
  for (const [i, v] of (value.ops as unknown[]).entries()) {
    const path = `ops.${i}`;
    if (!isRecord(v)) invalid(path);
    if (Object.keys(v).some((k) => !['op', 'kind', 'id', 'baseRev', 'doc'].includes(k)))
      invalid(path);
    if (v.op !== 'put' && v.op !== 'delete') invalid(path + '.op');
    if (!ITEM_KINDS.includes(v.kind as ItemKind)) invalid(path + '.kind');
    if (typeof v.id !== 'string' || !idPattern.test(v.id)) invalid(path + '.id');
    if (typeof v.baseRev !== 'number' || !Number.isSafeInteger(v.baseRev) || v.baseRev < 0)
      invalid(path + '.baseRev');
    if (Object.hasOwn(v, 'doc') !== (v.op === 'put')) invalid(path + '.doc');
    const key = `${v.kind}:${v.id}`;
    if (seen.has(key)) invalid(path);
    seen.add(key);
  }
  return value as unknown as EditBody;
}

/** `undo` 본문: `{ ids }` 또는 `{ requestId }` 중 하나. */
export function parseUndoBody(value: unknown): { ids: string[] } | { requestId: string } {
  if (!isRecord(value)) invalid('');
  const keys = Object.keys(value);
  if (keys.length !== 1) invalid('');
  if (keys[0] === 'requestId') {
    if (typeof value.requestId !== 'string' || !uuidPattern.test(value.requestId))
      invalid('requestId');
    return { requestId: value.requestId };
  }
  if (keys[0] !== 'ids') invalid('');
  const ids = value.ids;
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > UNDO_MAX_PER_CALL ||
    !ids.every((id) => typeof id === 'string' && uuidPattern.test(id))
  )
    invalid('ids');
  return { ids: ids as string[] };
}

type Row = { kind: ItemKind; id: string; rev: number; deleted: number; doc: string };

/** 설계서 「edit」 0~6단계. 라우트·토큰·한도 검사는 호출자가 한다. */
export async function editItems(
  db: MeetDb,
  who: { userId: string; tokenId: string },
  value: unknown,
  now: number,
): Promise<EditReply> {
  const body = parseEditBody(value);
  const at = new Date(now).toISOString();

  // 0단계: 같은 requestId로 이미 적용된 항목.
  const applied = new Map(
    (await listRequestChanges(db, who.userId, body.requestId)).map((c) => [
      `${c.kind}:${c.itemId}`,
      c.afterRev,
    ]),
  );

  // 여행 put이 가리키는 장소도 함께 읽는다(문서가 틀리면 5단계 전에 invalid로 걸러진다).
  const refKeys = body.ops.flatMap((op) => {
    if (op.op !== 'put' || op.kind !== 'trip') return [];
    const decoded = decodeItem('trip', op.id, op.doc);
    return decoded.ok ? tripRefs(decoded.doc as Trip).map((id) => ['place', id]) : [];
  });
  const rows = (
    await db
      .prepare(
        "SELECT kind, item_id AS id, rev, deleted, doc FROM library_items WHERE user_id = ?1 AND (kind, item_id) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?2))",
      )
      .bind(who.userId, JSON.stringify([...body.ops.map((op) => [op.kind, op.id]), ...refKeys]))
      .all<Row>()
  ).results;
  const stored = new Map(rows.map((r) => [itemKey(r.kind, r.id), r]));
  // 참조 검사 기준: 저장된 행 + 이 요청에서 앞서 통과한 항목. 장소는 있음(묘비 포함)만, 여행은 살아 있는 것의 참조.
  const places = new Set(rows.filter((r) => r.kind === 'place').map((r) => r.id));
  let trips: Map<string, string[]> | null = null;
  const liveTrips = async () =>
    (trips ??= new Map(
      (
        await db
          .prepare(
            "SELECT item_id AS id, refs FROM library_items WHERE user_id = ? AND kind = 'trip' AND deleted = 0",
          )
          .bind(who.userId)
          .all<{ id: string; refs: string | null }>()
      ).results.map((r) => [r.id, (r.refs ?? '').split(',').filter(Boolean)]),
    ));

  const results = new Map<string, EditResult>();
  const items: PushItem[] = [];
  for (const op of body.ops) {
    const key = itemKey(op.kind, op.id);
    const done = (status: EditStatus, extra: { rev?: number; doc?: unknown } = {}) =>
      results.set(key, { kind: op.kind, id: op.id, status, ...extra });
    const afterRev = applied.get(key);
    if (afterRev !== undefined) {
      done('ok', { rev: afterRev });
      continue;
    }
    // 1단계
    const row = stored.get(key);
    if ((row?.rev ?? 0) !== op.baseRev) {
      done('conflict', { rev: row?.rev ?? 0, ...(row ? { doc: JSON.parse(row.doc) } : {}) });
      continue;
    }
    const before = row ? (JSON.parse(row.doc) as AnyItem) : undefined;
    let doc: AnyItem;
    if (op.op === 'put') {
      // 2단계. 삭제는 delete로만 한다.
      if (!isRecord(op.doc) || op.doc.deletedAt !== null) {
        done('invalid');
        continue;
      }
      const decoded = decodeItem(op.kind, op.id, stampChangedFields(before, op.doc, at));
      if (!decoded.ok) {
        done(decoded.reason);
        continue;
      }
      doc = decoded.doc;
      // 4단계: 여행이 가리키는 장소는 행이 있어야 한다(묘비 가능). 라벨 참조는 보지 않는다.
      if (op.kind === 'trip') {
        const refs = tripRefs(doc as Trip);
        if (refs.some((id) => !places.has(id))) {
          done('invalid-ref');
          continue;
        }
        (await liveTrips()).set(op.id, refs);
      }
      if (op.kind === 'place') places.add(op.id);
    } else {
      // 3단계
      if (!before || before.deletedAt !== null) {
        done('missing');
        continue;
      }
      if (op.kind === 'place') {
        const using = [...(await liveTrips()).values()].some((refs) => refs.includes(op.id));
        if (using) {
          done('referenced');
          continue;
        }
      }
      if (op.kind === 'trip') (await liveTrips()).delete(op.id);
      doc = { ...before, deletedAt: at };
    }
    items.push({ kind: op.kind, id: op.id, baseRev: op.baseRev, baseDeleted: null, doc });
  }

  // 5단계: 통과한 항목을 병합 없이 한 번에 쓴다.
  const reply = await pushItems(
    db,
    { userId: who.userId },
    { v: 1, deviceId: 'agnt' + who.tokenId, items },
    now,
    LIBRARY_QUOTA,
    { noMerge: true },
  );
  for (const r of reply.rejected)
    results.set(itemKey(r.kind, r.id), { kind: r.kind, id: r.id, status: r.reason });
  for (const c of reply.conflicts ?? [])
    results.set(itemKey(c.kind, c.id), {
      kind: c.kind,
      id: c.id,
      status: 'conflict',
      rev: c.rev,
      ...(c.doc === null ? {} : { doc: c.doc }),
    });
  // 6단계: 실제로 rev가 올라간 항목만 기록한다.
  const changes: ChangeRow[] = [];
  for (const r of reply.results) {
    const key = itemKey(r.kind, r.id);
    results.set(key, { kind: r.kind, id: r.id, status: 'ok', rev: r.rev });
    const row = stored.get(key);
    if (r.rev === (row?.rev ?? 0)) continue;
    const item = items.find((i) => i.kind === r.kind && i.id === r.id)!;
    changes.push({
      id: crypto.randomUUID(),
      userId: who.userId,
      tokenId: who.tokenId,
      requestId: body.requestId,
      kind: r.kind,
      itemId: r.id,
      beforeDoc: row?.doc ?? null,
      beforeRev: row?.rev ?? 0,
      afterRev: r.rev,
      label: itemLabel(r.kind, item.doc as AnyItem).slice(0, LABEL_MAX_CHARS),
      at: now,
    });
  }
  await recordChanges(db, changes);
  return {
    rev: reply.rev,
    results: body.ops.map((op) => results.get(itemKey(op.kind, op.id))!),
  };
}

export type UndoStatus = 'undone' | 'changed' | 'already' | 'gone';
/** `more`는 `{ requestId }`일 때만 싣는다. true면 아직 되돌리지 않은 변경이 남아 다시 부르면 이어서 처리한다. */
export type UndoReply = { results: { id: string; status: UndoStatus }[]; more?: boolean };
type UndoRow = {
  id: string;
  token_id: string;
  kind: ItemKind;
  item_id: string;
  before_doc: string | null;
  after_rev: number;
  undone_at: number | null;
  /** 지금 행의 rev와, rev가 after_rev와 같을 때만 문서. */
  cur_rev: number | null;
  cur_doc: string | null;
};

/**
 * 설계서 「되돌리기」. 새 변경 기록은 만들지 않는다. 라우트·토큰·스위치 검사는 호출자가 한다.
 * 되돌릴 수 있는 변경을 최근부터 `UNDO_MAX_PER_CALL`건까지 한 번의 pushItems로 쓴다.
 */
export async function undoChanges(
  db: MeetDb,
  who: { userId: string },
  target: { ids: string[] } | { requestId: string },
  now: number,
): Promise<UndoReply> {
  const at = new Date(now).toISOString();
  const byIds = 'ids' in target;
  const found = (
    await db
      .prepare(
        `SELECT c.id, c.token_id, c.kind, c.item_id, c.before_doc, c.after_rev, c.undone_at, i.rev AS cur_rev, CASE WHEN i.rev = c.after_rev THEN i.doc END AS cur_doc FROM agent_changes c LEFT JOIN library_items i ON i.user_id = c.user_id AND i.kind = c.kind AND i.item_id = c.item_id WHERE c.user_id = ?1 AND c.at > ?2 AND ${
          byIds ? 'c.id IN (SELECT value FROM json_each(?3))' : 'c.request_id = ?3'
        } ORDER BY c.at DESC, c.rowid DESC`,
      )
      .bind(
        who.userId,
        now - CHANGES_KEEP_MS,
        byIds ? JSON.stringify(target.ids) : target.requestId,
      )
      .all<UndoRow>()
  ).results;

  const status = new Map<string, UndoStatus>();
  const ready: UndoRow[] = [];
  const keys = new Set<string>();
  for (const change of found) {
    const key = itemKey(change.kind, change.item_id);
    if (change.undone_at !== null) status.set(change.id, 'already');
    else if (change.cur_rev !== change.after_rev || keys.has(key)) status.set(change.id, 'changed');
    else {
      keys.add(key);
      ready.push(change);
    }
  }
  const batch = ready.slice(0, UNDO_MAX_PER_CALL);
  if (batch.length) {
    const items: PushItem[] = batch.map((change) => {
      const now0 = JSON.parse(change.cur_doc!) as AnyItem;
      const doc =
        change.before_doc === null
          ? { ...now0, deletedAt: at }
          : stampChangedFields(now0, JSON.parse(change.before_doc) as AnyItem, at);
      return {
        kind: change.kind,
        id: change.item_id,
        baseRev: change.after_rev,
        baseDeleted: null,
        doc,
      };
    });
    // 한 번에 쓰므로 기기 id는 가장 최근 변경의 토큰으로 남긴다(library_items.device_id는 읽지 않는 정보).
    const reply = await pushItems(
      db,
      { userId: who.userId },
      { v: 1, deviceId: 'agnt' + batch[0]!.token_id, items },
      now,
      LIBRARY_QUOTA,
      { noMerge: true },
    );
    const written = new Set(reply.results.map((r) => itemKey(r.kind, r.id)));
    const undone = batch.filter((c) => written.has(itemKey(c.kind, c.item_id)));
    if (undone.length)
      await db
        .prepare(
          'UPDATE agent_changes SET undone_at = ?1 WHERE user_id = ?2 AND id IN (SELECT value FROM json_each(?3))',
        )
        .bind(now, who.userId, JSON.stringify(undone.map((c) => c.id)))
        .run();
    const done = new Set(undone);
    for (const c of batch) status.set(c.id, done.has(c) ? 'undone' : 'changed');
  }
  const results: UndoReply['results'] = found
    .filter((c) => status.has(c.id))
    .map((c) => ({ id: c.id, status: status.get(c.id)! }));
  if (byIds) {
    const seen = new Set(found.map((c) => c.id));
    for (const id of target.ids) if (!seen.has(id)) results.push({ id, status: 'gone' });
    return { results };
  }
  return { results, more: ready.length > batch.length };
}
