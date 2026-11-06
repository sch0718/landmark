// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  editItems,
  parseUndoBody,
  undoChanges,
  UNDO_MAX_PER_CALL,
} from 'src/server/agent/library-edit';
import { pushItems } from 'src/server/library-sync/library';
import { ensureSchema, type MeetStatement } from 'src/server/meet/db';
import { SyncHttpError } from 'src/server/library-sync/http';
import type { ItemKind } from 'src/domain/library-sync/items';
import type { Place } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';
import { createSqliteD1 } from '../../helpers/sqlite-d1';

const now = Date.parse('2026-11-06T00:00:00.000Z');
const iso = new Date(now).toISOString();
const t = '2026-10-01T00:00:00.000Z';
const f = <T>(value: T, updatedAt = t) => ({ value, updatedAt });
const place = (id = 'place00001', memo = '처음'): Place => ({
  id,
  source: { kind: 'pin' },
  name: f('장소'),
  address: '',
  lng: 127,
  lat: 37,
  category: f(null),
  memo: f(memo),
  labelIds: f([]),
  saved: f(true),
  createdAt: t,
  deletedAt: null,
});
const trip = (id = 'trip000001', stops: string[] = [], title = '여행'): Trip => ({
  id,
  title: f(title),
  startDate: f('2026-11-10'),
  endDate: f('2026-11-10'),
  origin: f(null),
  candidates: f([]),
  days: [
    {
      stops: f(
        stops.map((placeId, i) => ({
          id: 'stop' + String(i).padStart(4, '0'),
          placeId,
          stayMin: null,
          fixedTime: null,
          note: '',
        })),
      ),
      lodging: f(null),
      startTime: f('09:00'),
    },
  ],
  legModes: f({}),
  createdAt: t,
  deletedAt: null,
});
const who = { userId: 'user-a', tokenId: 'tok000000001' };
const requestId = '11111111-2222-4333-8444-555555555555';
type Op = { op: 'put' | 'delete'; kind: ItemKind; id: string; baseRev: number; doc?: unknown };
const put = <D extends { id: string }>(kind: ItemKind, doc: D, baseRev = 0): Op => ({
  op: 'put',
  kind,
  id: doc.id,
  baseRev,
  doc,
});
const del = (kind: ItemKind, id: string, baseRev: number): Op => ({
  op: 'delete',
  kind,
  id,
  baseRev,
});

let db: ReturnType<typeof createSqliteD1>;
beforeEach(async () => {
  db = createSqliteD1();
  await ensureSchema(db);
});
afterEach(() => {
  vi.restoreAllMocks();
  db.close();
});

const edit = (ops: Op[], id = requestId) => editItems(db, who, { v: 1, requestId: id, ops }, now);
/** 다른 기기의 동기화 쓰기(기본 병합 방식). */
const seed = (items: [ItemKind, { id: string; deletedAt?: string | null }, number?][]) =>
  pushItems(
    db,
    { userId: who.userId },
    {
      v: 1,
      deviceId: 'b'.repeat(16),
      items: items.map(([kind, doc, baseRev = 0]) => ({
        kind,
        id: doc.id,
        baseRev,
        baseDeleted: null,
        doc,
      })),
    },
    now,
  );
const row = (kind: ItemKind, id: string) =>
  db
    .prepare(
      'SELECT rev, deleted, doc FROM library_items WHERE user_id = ? AND kind = ? AND item_id = ?',
    )
    .bind(who.userId, kind, id)
    .first<{ rev: number; deleted: number; doc: string }>();
const records = async () =>
  (
    await db.prepare('SELECT * FROM agent_changes ORDER BY rowid').all<{
      token_id: string;
      request_id: string;
      kind: string;
      item_id: string;
      before_doc: string | null;
      before_rev: number;
      after_rev: number;
      label: string;
      at: number;
    }>()
  ).results;

it('장소 메모를 교체하고 바뀐 필드에만 서버 시각을 찍어 기록한다', async () => {
  await seed([['place', place()]]);
  const before = (await row('place', 'place00001'))!.doc;
  const reply = await edit([
    put('place', { ...place(), memo: f('바꿈', '2020-01-01T00:00:00.000Z') }, 1),
  ]);
  expect(reply).toEqual({
    rev: 2,
    results: [{ kind: 'place', id: 'place00001', status: 'ok', rev: 2 }],
  });
  const doc = JSON.parse((await row('place', 'place00001'))!.doc) as Place;
  // 클라이언트가 보낸 오래된 시각은 무시하고 now를 찍는다.
  expect(doc.memo).toEqual({ value: '바꿈', updatedAt: iso });
  expect(doc.name.updatedAt).toBe(t);
  expect(await records()).toEqual([
    expect.objectContaining({
      token_id: who.tokenId,
      request_id: requestId,
      kind: 'place',
      item_id: 'place00001',
      before_doc: before,
      before_rev: 1,
      after_rev: 2,
      label: '장소',
      at: now,
    }),
  ]);
  const device = await db
    .prepare('SELECT device_id FROM library_items')
    .first<{ device_id: string }>();
  expect(device?.device_id).toBe('agnt' + who.tokenId);
});

it('새 장소는 baseRev 0으로 추가하고 모든 필드 시각이 now다', async () => {
  const reply = await edit([put('place', place())]);
  expect(reply.results[0]).toEqual({ kind: 'place', id: 'place00001', status: 'ok', rev: 1 });
  const doc = JSON.parse((await row('place', 'place00001'))!.doc) as Place;
  expect(
    [doc.name, doc.memo, doc.category, doc.labelIds, doc.saved].map((x) => x.updatedAt),
  ).toEqual(Array(5).fill(iso));
  expect(await records()).toEqual([
    expect.objectContaining({ before_doc: null, before_rev: 0, after_rev: 1 }),
  ]);
});

it('새 항목에 baseRev가 0이 아니면, 기존 항목의 baseRev가 다르면 conflict다', async () => {
  await seed([['place', place()]]);
  const reply = await edit([
    put('place', place('place00002'), 3),
    put('place', { ...place(), memo: f('바꿈') }, 7),
  ]);
  expect(reply.results).toEqual([
    { kind: 'place', id: 'place00002', status: 'conflict', rev: 0 },
    { kind: 'place', id: 'place00001', status: 'conflict', rev: 1, doc: place() },
  ]);
  expect(await row('place', 'place00002')).toBeNull();
  expect(await records()).toEqual([]);
});

it('여행 put은 행이 없는 장소를 invalid-ref로, 묘비 장소 참조는 받는다', async () => {
  await seed([
    ['place', { ...place(), deletedAt: t }],
    ['trip', trip('trip000001', ['place00001'])],
  ]);
  const reply = await edit([
    put('trip', trip('trip000002', ['place00009'])),
    put('trip', trip('trip000003', ['place00001'])),
    put('trip', trip('trip000001', ['place00001'], '제목만 바꿈'), 1),
  ]);
  expect(reply.results.map((r) => r.status)).toEqual(['invalid-ref', 'ok', 'ok']);
  expect(await row('trip', 'trip000002')).toBeNull();
});

it('지워지지 않은 여행이 쓰는 장소 delete는 referenced다', async () => {
  await seed([
    ['place', place()],
    ['trip', trip('trip000001', ['place00001'])],
  ]);
  const reply = await edit([del('place', 'place00001', 1)]);
  expect(reply.results[0]?.status).toBe('referenced');
  expect((await row('place', 'place00001'))!.deleted).toBe(0);
});

it('put의 문서에 deletedAt이 있으면 invalid다', async () => {
  await seed([['place', place()]]);
  const reply = await edit([put('place', { ...place(), deletedAt: t }, 1)]);
  expect(reply.results[0]?.status).toBe('invalid');
  expect((await row('place', 'place00001'))!.deleted).toBe(0);
});

it('장소·폴더가 없는 라벨을 가리켜도 서버는 거절하지 않는다', async () => {
  const folder = {
    shareId: 'abc123',
    name: f('폴더'),
    labelId: f('label099'),
    seenSids: f([]),
    checkedAt: t,
    createdAt: t,
    deletedAt: null,
  };
  const reply = await edit([
    put('place', { ...place(), labelIds: f(['label099']) }),
    { op: 'put', kind: 'folder', id: 'abc123', baseRev: 0, doc: folder },
  ]);
  expect(reply.results.map((r) => r.status)).toEqual(['ok', 'ok']);
});

it('한 요청 안에서 앞 항목의 결과를 참조 검사에 쓴다', async () => {
  await seed([
    ['place', place('place00002')],
    ['place', place('place00003')],
    ['trip', trip('trip000001', ['place00002'])],
  ]);
  const reply = await edit([
    // 새 장소 put 뒤 그 장소를 넣은 여행 put
    put('place', place('place00001')),
    put('trip', trip('trip000002', ['place00001'])),
    // 여행 put으로 뺀 장소 delete
    put('trip', trip('trip000001', []), 1),
    del('place', 'place00002', 1),
    // 참조되지 않은 장소 delete 뒤 그 묘비를 참조하는 여행 put
    del('place', 'place00003', 1),
    put('trip', trip('trip000003', ['place00003'])),
  ]);
  expect(reply.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
  expect((await row('place', 'place00002'))!.deleted).toBe(1);
  expect(JSON.parse((await row('place', 'place00003'))!.doc).deletedAt).toBe(iso);
});

it('같은 kind:id 두 번과 51개 요청은 요청 전체를 422 invalid로 거절한다', async () => {
  await expect(edit([put('place', place()), del('place', 'place00001', 0)])).rejects.toMatchObject({
    status: 422,
    code: 'invalid',
    extra: { path: 'ops.1' },
  });
  const many = Array.from({ length: 51 }, (_, i) =>
    put('place', place('place' + String(i).padStart(5, '0'))),
  );
  const error = await edit(many).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(SyncHttpError);
  expect(error).toMatchObject({ status: 422, code: 'invalid', extra: { path: 'ops' } });
  await expect(
    editItems(db, who, { v: 1, requestId: 'x', ops: [put('place', place())] }, now),
  ).rejects.toMatchObject({
    status: 422,
    extra: { path: 'requestId' },
  });
  expect(await row('place', 'place00001')).toBeNull();
});

it('이미 지운 항목이나 없는 항목 delete는 missing이다', async () => {
  await seed([['place', { ...place(), deletedAt: t }]]);
  const reply = await edit([del('place', 'place00001', 1), del('place', 'place00002', 0)]);
  expect(reply.results.map((r) => r.status)).toEqual(['missing', 'missing']);
  expect(await records()).toEqual([]);
});

it('크기·시계·사용자 상한은 too-large·clock·too-large로 거절한다', async () => {
  const reply = await edit([
    put('place', { ...place(), memo: f('x'.repeat(200001)) }),
    put('place', { ...place('place00002'), createdAt: new Date(now + 3_600_000).toISOString() }),
  ]);
  expect(reply.results.map((r) => r.status)).toEqual(['too-large', 'clock']);
  await db
    .prepare(
      "INSERT INTO library_items (user_id, kind, item_id, rev, doc, deleted, deleted_at, refs, device_id, updated_at) VALUES (?, 'label', 'big00001', 1, ?, 0, NULL, NULL, 'x', 0)",
    )
    .bind(who.userId, 'x'.repeat(5_000_000))
    .run();
  const full = await edit([put('place', place('place00003'))], crypto.randomUUID());
  expect(full.results[0]?.status).toBe('too-large');
  expect(await records()).toEqual([]);
});

it('같은 requestId 재전송은 적용된 항목을 ok·기록의 after_rev로 답하고 conflict였던 항목은 다시 처리한다', async () => {
  await seed([
    ['place', place()],
    ['place', place('place00002')],
  ]);
  const ops = [
    put('place', { ...place(), memo: f('A') }, 1),
    put('place', { ...place('place00002'), memo: f('B') }, 9),
  ];
  const first = await edit(ops);
  expect(first.results.map((r) => r.status)).toEqual(['ok', 'conflict']);
  const rowA = await row('place', 'place00001');
  const again = await edit([ops[0]!, { ...ops[1]!, baseRev: 1 }]);
  expect(again.results).toEqual([
    { kind: 'place', id: 'place00001', status: 'ok', rev: 2 },
    { kind: 'place', id: 'place00002', status: 'ok', rev: 3 },
  ]);
  expect(await row('place', 'place00001')).toEqual(rowA);
  expect((await records()).map((r) => [r.item_id, r.after_rev])).toEqual([
    ['place00001', 2],
    ['place00002', 3],
  ]);
});

it('바뀐 내용이 없는 항목은 rev를 올리지 않고 기록하지 않는다', async () => {
  await seed([['place', place()]]);
  const reply = await edit([put('place', place(), 1)]);
  expect(reply).toEqual({
    rev: 1,
    results: [{ kind: 'place', id: 'place00001', status: 'ok', rev: 1 }],
  });
  expect(await records()).toEqual([]);
});

const otherDevice = (doc: Place, baseRev: number) => seed([['place', doc, baseRev]]);

it('1단계 이후 다른 기기가 고치면 conflict이고 그 기기 값을 보존하며 기록하지 않는다', async () => {
  await seed([['place', place()]]);
  const prepare = db.prepare.bind(db);
  let armed = true;
  vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
    const stmt = prepare(sql);
    if (!armed || sql !== 'SELECT rev FROM library_state WHERE user_id = ?') return stmt;
    armed = false;
    // pushItems가 처음 읽기 직전에 다른 기기가 쓴다.
    return {
      bind: (...values: (string | number | null)[]) => {
        const bound = stmt.bind(...values);
        const first = bound.first.bind(bound);
        bound.first = async <T>() => {
          await otherDevice({ ...place(), name: f('다른 기기', '2026-10-20T00:00:00.000Z') }, 1);
          return first<T>();
        };
        return bound;
      },
    } as MeetStatement;
  });
  const reply = await edit([put('place', { ...place(), memo: f('AI') }, 1)]);
  expect(reply.results[0]).toMatchObject({
    status: 'conflict',
    rev: 2,
    doc: { name: { value: '다른 기기' } },
  });
  const doc = JSON.parse((await row('place', 'place00001'))!.doc) as Place;
  expect([doc.name.value, doc.memo.value]).toEqual(['다른 기기', '처음']);
  expect(await records()).toEqual([]);
});

it('쓰기 직전 다른 기기의 수정·같은 id 생성은 재시도에서도 병합하지 않고 conflict다', async () => {
  await seed([
    ['place', place()],
    ['place', place('place00002')],
  ]);
  const batch = db.batch.bind(db);
  let armed = true;
  vi.spyOn(db, 'batch').mockImplementation(async (stmts) => {
    if (armed) {
      armed = false;
      await otherDevice({ ...place(), name: f('다른 기기', '2026-10-20T00:00:00.000Z') }, 1);
      await otherDevice(place('place00003', '다른 기기 새 장소'), 0);
    }
    return batch(stmts);
  });
  const reply = await edit([
    put('place', { ...place(), memo: f('AI') }, 1),
    put('place', { ...place('place00002'), memo: f('AI') }, 1),
    put('place', place('place00003', 'AI 새 장소')),
  ]);
  expect(reply.results).toEqual([
    expect.objectContaining({ id: 'place00001', status: 'conflict', rev: 2 }),
    { kind: 'place', id: 'place00002', status: 'ok', rev: 4 },
    expect.objectContaining({ id: 'place00003', status: 'conflict', rev: 3 }),
  ]);
  const one = JSON.parse((await row('place', 'place00001'))!.doc) as Place;
  expect([one.name.value, one.memo.value]).toEqual(['다른 기기', '처음']);
  expect((JSON.parse((await row('place', 'place00003'))!.doc) as Place).memo.value).toBe(
    '다른 기기 새 장소',
  );
  expect((await records()).map((r) => [r.item_id, r.before_rev, r.after_rev])).toEqual([
    ['place00002', 1, 4],
  ]);
});

it('배치 뒤 다른 기기가 성공한 항목을 고쳐도 그 항목은 ok로 기록한다', async () => {
  await seed([
    ['place', place()],
    ['place', place('place00002')],
  ]);
  const batch = db.batch.bind(db);
  let armed = true;
  vi.spyOn(db, 'batch').mockImplementation(async (stmts) => {
    if (!armed) return batch(stmts);
    armed = false;
    // 배치 직전에 1번을, 배치 직후(후속 읽기 전)에 2번을 다른 기기가 고친다.
    await otherDevice({ ...place(), name: f('다른 기기', '2026-10-20T00:00:00.000Z') }, 1);
    const out = await batch(stmts);
    await otherDevice(
      { ...place('place00002'), name: f('다른 기기', '2026-10-20T00:00:00.000Z') },
      3,
    );
    return out;
  });
  const reply = await edit([
    put('place', { ...place(), memo: f('AI') }, 1),
    put('place', { ...place('place00002'), memo: f('AI') }, 1),
  ]);
  expect(reply.results).toEqual([
    expect.objectContaining({ id: 'place00001', status: 'conflict', rev: 2 }),
    { kind: 'place', id: 'place00002', status: 'ok', rev: 3 },
  ]);
  expect((await records()).map((r) => [r.item_id, r.before_rev, r.after_rev])).toEqual([
    ['place00002', 1, 3],
  ]);
});

const undo = (target: { ids: string[] } | { requestId: string }, at = now) =>
  undoChanges(db, { userId: who.userId }, target, at);
const changeIds = async () =>
  (
    await db.prepare('SELECT id FROM agent_changes ORDER BY rowid').all<{ id: string }>()
  ).results.map((r) => r.id);
const parsed = async (kind: ItemKind, id: string) => JSON.parse((await row(kind, id))!.doc);

it('되돌리기: 수정을 복원하고 바뀐 필드에 시각을 찍으며 새 기록은 만들지 않는다', async () => {
  await seed([['place', place()]]);
  await edit([put('place', { ...place(), memo: f('AI') }, 1)]);
  const id = (await changeIds())[0]!;
  const later = now + 1000;
  expect(await undo({ ids: [id] }, later)).toEqual({ results: [{ id, status: 'undone' }] });
  const doc = await parsed('place', 'place00001');
  expect(doc.memo).toEqual({ value: '처음', updatedAt: new Date(later).toISOString() });
  expect(doc.name.updatedAt).toBe(t);
  expect((await row('place', 'place00001'))!.rev).toBe(3);
  expect(await records()).toHaveLength(1);
  expect(await undo({ ids: [id] }, later)).toEqual({ results: [{ id, status: 'already' }] });
});

it('되돌리기: AI가 새로 만든 항목은 묘비가 된다', async () => {
  await edit([put('place', place())]);
  const id = (await changeIds())[0]!;
  expect((await undo({ ids: [id] })).results[0]!.status).toBe('undone');
  const r = (await row('place', 'place00001'))!;
  expect(r.deleted).toBe(1);
  expect((JSON.parse(r.doc) as Place).deletedAt).toBe(iso);
});

it('되돌리기: AI가 지운 항목은 묘비가 풀린다', async () => {
  await seed([['place', place()]]);
  await edit([del('place', 'place00001', 1)]);
  const id = (await changeIds())[0]!;
  expect((await undo({ ids: [id] })).results[0]!.status).toBe('undone');
  const r = (await row('place', 'place00001'))!;
  expect(r.deleted).toBe(0);
  expect((JSON.parse(r.doc) as Place).deletedAt).toBeNull();
});

it('되돌리기: 그 사이 다른 기기가 고쳤으면 changed이고 덮어쓰지 않는다', async () => {
  await seed([['place', place()]]);
  await edit([put('place', { ...place(), memo: f('AI') }, 1)]);
  const id = (await changeIds())[0]!;
  await otherDevice({ ...place(), name: f('다른 기기', '2026-10-20T00:00:00.000Z') }, 2);
  expect(await undo({ ids: [id] })).toEqual({ results: [{ id, status: 'changed' }] });
  expect((await parsed('place', 'place00001')).name.value).toBe('다른 기기');
  expect(
    (await db.prepare('SELECT undone_at FROM agent_changes').first<{ undone_at: number | null }>())!
      .undone_at,
  ).toBeNull();
});

it('되돌리기: 없는 id와 만료된 기록은 gone이다', async () => {
  await seed([['place', place()]]);
  await edit([put('place', { ...place(), memo: f('AI') }, 1)]);
  const id = (await changeIds())[0]!;
  const old = now + 31 * 24 * 60 * 60 * 1000;
  expect(await undo({ ids: [id, 'nope'] }, old)).toEqual({
    results: [
      { id, status: 'gone' },
      { id: 'nope', status: 'gone' },
    ],
  });
});

it('되돌리기: requestId 묶음은 같은 at이면 나중 기록부터 처리한다', async () => {
  await edit([put('place', place()), put('place', place('place00002'))]);
  const [a, b] = (await changeIds()) as [string, string];
  expect(await undo({ requestId })).toEqual({
    results: [
      { id: b, status: 'undone' },
      { id: a, status: 'undone' },
    ],
    more: false,
  });
});

it('되돌리기: 같은 항목의 변경 A·B에서 B를 되돌리면 A는 changed로 남는다', async () => {
  await seed([['place', place()]]);
  await edit(
    [put('place', { ...place(), memo: f('A') }, 1)],
    '11111111-2222-4333-8444-555555555551',
  );
  await edit(
    [put('place', { ...place(), memo: f('B') }, 2)],
    '11111111-2222-4333-8444-555555555552',
  );
  const [a, b] = (await changeIds()) as [string, string];
  expect((await undo({ ids: [b] })).results[0]!.status).toBe('undone');
  expect((await undo({ ids: [a] })).results[0]!.status).toBe('changed');
  expect((await parsed('place', 'place00001')).memo.value).toBe('A');
});

it('되돌리기: 검사와 쓰기 사이 다른 기기 변경은 changed로 보존하고 기록을 남기지 않는다', async () => {
  await seed([['place', place()]]);
  await edit([put('place', { ...place(), memo: f('AI') }, 1)]);
  const id = (await changeIds())[0]!;
  const batch = db.batch.bind(db);
  let armed = true;
  vi.spyOn(db, 'batch').mockImplementation(async (stmts) => {
    if (armed) {
      armed = false;
      await otherDevice({ ...place(), name: f('다른 기기', '2026-10-20T00:00:00.000Z') }, 2);
    }
    return batch(stmts);
  });
  expect(await undo({ ids: [id] })).toEqual({ results: [{ id, status: 'changed' }] });
  const doc = await parsed('place', 'place00001');
  // 다른 기기 문서가 그대로 남는다(되돌리기가 덮어쓰지 않음).
  expect([doc.name.value, doc.memo.value]).toEqual(['다른 기기', '처음']);
  expect((await row('place', 'place00001'))!.rev).toBe(3);
  expect(
    (await db.prepare('SELECT undone_at FROM agent_changes').first<{ undone_at: number | null }>())!
      .undone_at,
  ).toBeNull();
});

const manyPlaces = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => place('place' + String(from + i).padStart(5, '0')));
/** D1 호출 수를 센다. 배치 안 문장도 prepare로 세므로 prepare 수가 실행한 SQL 문 수다. */
const countQueries = () => {
  const counts = { prepare: 0, batch: 0 };
  const prepare = db.prepare.bind(db);
  const batch = db.batch.bind(db);
  vi.spyOn(db, 'prepare').mockImplementation((sql: string) => (counts.prepare++, prepare(sql)));
  vi.spyOn(db, 'batch').mockImplementation(async (stmts) => (counts.batch++, batch(stmts)));
  return counts;
};

it('되돌리기: ids가 상한을 넘으면 요청 전체를 422 invalid(ids)로 거절한다', () => {
  const ids = Array.from({ length: UNDO_MAX_PER_CALL + 1 }, () => crypto.randomUUID());
  const error = (() => {
    try {
      return parseUndoBody({ ids });
    } catch (e) {
      return e;
    }
  })();
  expect(error).toBeInstanceOf(SyncHttpError);
  expect(error).toMatchObject({ status: 422, code: 'invalid', extra: { path: 'ids' } });
  expect(parseUndoBody({ ids: ids.slice(1) })).toEqual({ ids: ids.slice(1) });
});

it('되돌리기: requestId 묶음이 상한보다 크면 최근부터 상한만큼 처리하고 more로 남은 것을 알린다', async () => {
  await edit(manyPlaces(UNDO_MAX_PER_CALL).map((p) => put('place', p)));
  await edit([put('place', place('place99999'))]);
  const ids = await changeIds();
  expect(ids).toHaveLength(UNDO_MAX_PER_CALL + 1);
  const first = await undo({ requestId });
  expect(first.more).toBe(true);
  expect(first.results).toHaveLength(UNDO_MAX_PER_CALL);
  expect(first.results.every((r) => r.status === 'undone')).toBe(true);
  // 가장 오래된 기록(첫 요청의 첫 항목)이 남는다.
  expect(first.results.map((r) => r.id)).not.toContain(ids[0]);
  const second = await undo({ requestId });
  expect(second.more).toBe(false);
  expect(second.results.find((r) => r.id === ids[0])).toEqual({ id: ids[0], status: 'undone' });
  const rows = (await db.prepare('SELECT deleted FROM library_items').all<{ deleted: number }>())
    .results;
  expect(rows.every((r) => r.deleted === 1)).toBe(true);
  expect((await undo({ requestId })).more).toBe(false);
});

it('되돌리기: 상한만큼을 한 번에 되돌려도 D1 쿼리는 호출당 40개 이하다', async () => {
  await edit(manyPlaces(UNDO_MAX_PER_CALL).map((p) => put('place', p)));
  const created = countQueries();
  const reply = await undo({ requestId });
  expect(reply.results.filter((r) => r.status === 'undone')).toHaveLength(UNDO_MAX_PER_CALL);
  expect(created.prepare).toBeLessThanOrEqual(40);
  vi.restoreAllMocks();

  // 지운 항목 복원도 ids로 같은 한도 안이다(측정: 둘 다 prepare 7·batch 1).
  const other = '11111111-2222-4333-8444-555555555556';
  await seed(manyPlaces(UNDO_MAX_PER_CALL, 100).map((p) => ['place', p] as [ItemKind, Place]));
  const base = (await row('place', 'place00100'))!.rev;
  await edit(
    manyPlaces(UNDO_MAX_PER_CALL, 100).map((p) => del('place', p.id, base)),
    other,
  );
  const ids = (
    await db
      .prepare('SELECT id FROM agent_changes WHERE request_id = ?')
      .bind(other)
      .all<{ id: string }>()
  ).results.map((r) => r.id);
  const restored = countQueries();
  const again = await undo({ ids });
  expect(again.results.filter((r) => r.status === 'undone')).toHaveLength(UNDO_MAX_PER_CALL);
  expect(restored.prepare).toBeLessThanOrEqual(40);
});

it('편집: 50개 항목을 한 번에 편집해도 D1 쿼리는 호출당 40개 이하다', async () => {
  const counts = countQueries();
  const reply = await edit(manyPlaces(50).map((p) => put('place', p)));
  expect(reply).toBeDefined();
  expect(
    (await db.prepare('SELECT COUNT(*) AS n FROM agent_changes').first<{ n: number }>())!.n,
  ).toBe(50);
  expect(counts.prepare).toBeLessThanOrEqual(40);
});
