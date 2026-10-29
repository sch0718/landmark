// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTripShareDoc } from 'src/domain/share/build-trip-share';
import { liveExpiresAt, LIVE_DOC_MAX_BYTES } from 'src/domain/trip-live/live-doc';
import { ensureSchema, resetSchemaMemo } from 'src/server/meet/db';
import type { MeetContext } from 'src/server/meet/env';
import {
  handleLiveCreate,
  handleLiveGet,
  handleLiveUpdate,
  handleLiveRotate,
  handleLiveDelete,
  pruneExpiredLive,
} from 'src/server/trip-live/handlers';
import { createSqliteD1 } from '../../helpers/sqlite-d1';
import { buildLiveLibrary } from '../../fixtures/builders';

const id = 'abcdefghij';
const owner = 'o'.repeat(43),
  view = 'v'.repeat(43),
  fresh = 'n'.repeat(43);
const now = new Date('2026-11-01T00:00:00Z');
const deps = { now: () => now, fetch: vi.fn<typeof fetch>() };
let db: ReturnType<typeof createSqliteD1>;
let pending: Promise<unknown>[];
const doc = () => ({
  format: 'landmark-trip-live',
  v: 1,
  share: buildTripShareDoc(
    buildLiveLibrary(),
    'trip000001',
    () => ({
      durationS: 0,
      distanceM: 0,
      tollFare: null,
      status: 'estimated',
      queriedAt: null,
      path: [],
    }),
    { title: '시험 여행', includeMemo: false, includeCandidates: true, now },
  )!,
  ids: { days: ['day00001', 'day00002'], stops: [['stop0001'], ['stop0002']] },
  options: { includeMemo: false, includeCandidates: true },
});
const input = () => ({
  id,
  sourceTripId: 'trip000001',
  ownerToken: owner,
  viewToken: view,
  doc: doc(),
  turnstile: 'dev',
});
function ctx(
  method = 'POST',
  body: unknown = input(),
  token?: string,
  path = '',
  extra: Partial<MeetContext['env']> = {},
): MeetContext {
  return {
    request: new Request(`http://localhost:5173/api/trip-live/${id}${path}`, {
      method,
      headers: {
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(method === 'GET' || method === 'DELETE' ? {} : { body: JSON.stringify(body) }),
    }),
    env: { DB: db, ...extra },
    params: { id },
    waitUntil(p) {
      pending.push(p);
    },
  };
}
const create = () => handleLiveCreate(ctx(), deps);
const get = (token = view, path = '') => handleLiveGet(ctx('GET', null, token, path), deps);
const update = (baseRev = 1, token = owner) =>
  handleLiveUpdate(ctx('PUT', { doc: doc(), baseRev }, token), deps);
const rotate = (body: unknown, token = owner) => handleLiveRotate(ctx('POST', body, token), deps);
beforeEach(async () => {
  resetSchemaMemo();
  db = createSqliteD1();
  pending = [];
  await ensureSchema(db);
  deps.fetch.mockReset();
});
afterEach(async () => {
  await Promise.all(pending);
  db.close();
  vi.restoreAllMocks();
});
describe('여행 갱신 공유 서버', () => {
  it('만들기는 소유자 해시만 저장하며 기한을 계산한다', async () => {
    const r = await create();
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({
      id,
      rev: 1,
      created: true,
      expiresAt: liveExpiresAt('2026-12-10', now).toISOString(),
    });
    const row = await db.prepare('SELECT hash FROM trip_share_tokens').first<{ hash: string }>();
    expect(row?.hash).not.toBe(owner);
    expect(
      await db
        .prepare('SELECT COUNT(*) AS n FROM trip_share_tokens WHERE hash = ?')
        .bind(owner)
        .first(),
    ).toEqual({ n: 0 });
  });
  it('같은 만들기 재시도는 처음 문서·버전을 유지한다', async () => {
    await create();
    const x = input();
    x.doc.share.title = '다른 제목';
    const r = await handleLiveCreate(ctx('POST', x), deps);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ created: false, rev: 1 });
    expect((await (await get()).json()).doc.share.title).toBe('시험 여행');
  });
  it('다른 소유자가 같은 id를 쓰면 taken이다', async () => {
    await create();
    const r = await handleLiveCreate(ctx('POST', { ...input(), ownerToken: fresh }), deps);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ reason: 'taken' });
  });
  it('동시 만들기도 같은 공유 하나를 돌려준다', async () => {
    const rs = await Promise.all([create(), create()]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 201]);
  });
  it('꺼짐·설정 누락·Turnstile 실패를 구분한다', async () => {
    expect(
      await (
        await handleLiveCreate(
          ctx('POST', input(), undefined, '', { TRIP_SHARE_LIVE: 'off' }),
          deps,
        )
      ).json(),
    ).toMatchObject({ reason: 'off' });
    const c = ctx();
    c.request = new Request('https://landmark.sch0718.dev/api/trip-live', {
      method: 'POST',
      headers: { Origin: 'https://landmark.sch0718.dev' },
      body: JSON.stringify(input()),
    });
    c.env.IP_HASH_SALT = '시험';
    expect(await (await handleLiveCreate(c, deps)).json()).toMatchObject({ reason: 'config' });
    deps.fetch.mockResolvedValue(Response.json({ success: false }));
    expect(
      await (
        await handleLiveCreate(
          ctx('POST', input(), undefined, '', { TURNSTILE_SECRET: '시험' }),
          deps,
        )
      ).json(),
    ).toMatchObject({ reason: 'turnstile' });
  });
  it('문서·같은 토큰·출처·id·요청 크기를 검사한다', async () => {
    expect(
      await (await handleLiveCreate(ctx('POST', { ...input(), doc: {} }), deps)).json(),
    ).toMatchObject({ reason: 'doc' });
    expect(
      (await handleLiveCreate(ctx('POST', { ...input(), viewToken: owner }), deps)).status,
    ).toBe(400);
    const c = ctx();
    c.request.headers.set('Origin', 'https://wrong.example');
    expect((await handleLiveCreate(c, deps)).status).toBe(403);
    const large = ctx();
    large.request.headers.set('Content-Length', '600001');
    expect((await handleLiveCreate(large, deps)).status).toBe(413);
    const bad = ctx('GET');
    bad.params.id = 'BAD';
    expect((await handleLiveGet(bad, deps)).status).toBe(400);
  });
  it('문서 바이트 한도를 따로 검사한다', async () => {
    const x = input();
    x.doc.share.places[0]!.memo = '가'.repeat(180_000);
    expect(new TextEncoder().encode(JSON.stringify(x.doc)).length).toBeGreaterThan(
      LIVE_DOC_MAX_BYTES,
    );
    expect((await handleLiveCreate(ctx('POST', x), deps)).status).toBe(413);
  });
  it('21번째 만들기는 일 한도를 넘는다', async () => {
    for (let n = 0; n < 20; n++) expect((await create()).ok).toBe(true);
    expect((await create()).status).toBe(429);
  });
  it('보기와 소유자 응답은 권한별로 다르고 문서는 같다', async () => {
    await create();
    const r = await get();
    expect(r.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await r.json()).toMatchObject({ role: 'view', doc: doc() });
    const v = await (await get()).json();
    expect(v.viewToken).toBeUndefined();
    expect(v.sourceTripId).toBeUndefined();
    expect(await (await get(owner)).json()).toMatchObject({
      role: 'owner',
      viewToken: view,
      sourceTripId: 'trip000001',
    });
  });
  it('304는 본문·문서 조회가 없다', async () => {
    await create();
    await Promise.all(pending);
    const spy = vi.spyOn(db, 'prepare');
    const r = await get(view, '?since=1');
    expect(r.status).toBe(304);
    expect(await r.text()).toBe('');
    expect(r.headers.get('Cache-Control')).toBe('private, no-store');
    expect(spy.mock.calls.some(([sql]) => /SELECT doc FROM/.test(sql))).toBe(false);
  });
  it('토큰 없거나 잘못된 읽기와 쓰기·철회·삭제를 거절한다', async () => {
    await create();
    expect((await handleLiveGet(ctx('GET', null), deps)).status).toBe(401);
    expect((await get(fresh)).status).toBe(401);
    expect((await update(1, view)).status).toBe(401);
    expect((await rotate({ view: fresh }, view)).status).toBe(401);
    expect((await handleLiveDelete(ctx('DELETE', null, view), deps)).status).toBe(401);
  });
  it('없는 공유·만료 읽기에만 읽기 한도를 센다', async () => {
    expect((await get()).status).toBe(404);
    await create();
    await get();
    await get(view, '?since=1');
    await get(fresh);
    expect(
      await db.prepare("SELECT count FROM rate_counters WHERE key LIKE 'tripRead:%'").first(),
    ).toEqual({ count: 1 });
    await Promise.all(pending);
    await db.prepare('UPDATE trip_shares SET expires_at = ?').bind(now.toISOString()).run();
    expect((await get()).status).toBe(410);
    expect(
      await db.prepare("SELECT count FROM rate_counters WHERE key LIKE 'tripRead:%'").first(),
    ).toEqual({ count: 2 });
  });
  it('낡은 버전은 409이고 성공한 올리기는 버전·시각·문서를 갱신한다', async () => {
    await create();
    const x = doc();
    x.share.title = '새 제목';
    const r = await handleLiveUpdate(ctx('PUT', { doc: x, baseRev: 1 }, owner), {
      ...deps,
      now: () => new Date(now.getTime() + 1000),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ rev: 2 });
    const conflict = await update();
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ rev: 2 });
    expect(await (await get()).json()).toMatchObject({
      rev: 2,
      updatedAt: '2026-11-01T00:00:01.000Z',
      doc: x,
    });
  });
  it('꺼져도 읽기·링크 다시 만들기·삭제는 된다', async () => {
    await create();
    const c = ctx('PUT', { doc: doc(), baseRev: 1 }, owner, '', { TRIP_SHARE_LIVE: 'off' });
    expect((await handleLiveUpdate(c, deps)).status).toBe(503);
    expect(
      (await handleLiveGet(ctx('GET', null, view, '', { TRIP_SHARE_LIVE: 'off' }), deps)).status,
    ).toBe(200);
    expect(
      (
        await handleLiveRotate(
          ctx('POST', { view: fresh }, owner, '', { TRIP_SHARE_LIVE: 'off' }),
          deps,
        )
      ).status,
    ).toBe(200);
    expect(
      (await handleLiveDelete(ctx('DELETE', null, owner, '', { TRIP_SHARE_LIVE: 'off' }), deps))
        .status,
    ).toBe(204);
  });
  it('보기 링크를 다시 만들면 이전 링크는 끊기고 재시도는 같은 버전이다', async () => {
    await create();
    expect(await (await rotate({ view: fresh })).json()).toEqual({ rev: 1 });
    expect((await get()).status).toBe(401);
    expect((await get(fresh)).status).toBe(200);
    expect((await rotate({ view: fresh })).status).toBe(200);
  });
  it('소유자 링크를 다시 만든 뒤 이전 토큰의 재시도를 허용한다', async () => {
    await create();
    expect((await rotate({ owner: fresh })).status).toBe(200);
    expect((await update()).status).toBe(401);
    expect((await rotate({ owner: fresh })).status).toBe(200);
    expect((await update(1, fresh)).status).toBe(200);
  });
  it('61번째 링크 다시 만들기는 일 한도를 넘는다', async () => {
    await create();
    for (let n = 0; n < 60; n++) expect((await rotate({ view: fresh })).status).toBe(200);
    expect((await rotate({ view: fresh })).status).toBe(429);
  });
  it('삭제는 만료에도 가능하며 토큰도 지운다', async () => {
    await create();
    await Promise.all(pending);
    await db.prepare('UPDATE trip_shares SET expires_at = ?').bind(now.toISOString()).run();
    const r = await handleLiveDelete(ctx('DELETE', null, owner), deps);
    expect(r.status).toBe(204);
    expect(r.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await get()).status).toBe(404);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM trip_share_tokens').first()).toEqual({
      n: 0,
    });
  });
  it('만료 정리는 토큰과 함께 최대 20개를 지운다', async () => {
    await create();
    await Promise.all(pending);
    for (let i = 0; i < 25; i++) {
      await db
        .prepare(
          'INSERT INTO trip_shares SELECT ?,doc,rev,view_token,source_trip_id,created_at,updated_at,? FROM trip_shares WHERE id = ?',
        )
        .bind(`x${String(i).padStart(9, '0')}`, now.toISOString(), id)
        .run();
      await db
        .prepare('INSERT INTO trip_share_tokens VALUES (?, ?, ?, NULL, NULL, ?)')
        .bind(`해시${i}`, `x${String(i).padStart(9, '0')}`, 'owner', now.toISOString())
        .run();
    }
    expect(await pruneExpiredLive(db, now, 20)).toBe(20);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM trip_share_tokens').first()).toEqual({
      n: 6,
    });
  });
});

it('PUT 본문을 받는 사이 소유자가 철회되면 저장하지 않는다', async () => {
  await create();
  const raw = db.prepare.bind(db);
  let authenticated!: () => void;
  const checked = new Promise<void>((r) => (authenticated = r));
  vi.spyOn(db, 'prepare').mockImplementation((sql) => {
    const stmt = raw(sql);
    if (sql.includes('SELECT hash FROM trip_share_tokens')) {
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...values) => {
        const bound = bind(...values),
          first = bound.first.bind(bound);
        bound.first = async <T>() => {
          const value = await first<T>();
          authenticated();
          return value;
        };
        return bound;
      };
    }
    return stmt;
  });
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const request = ctx('PUT', {}, owner);
  request.request = new Request(request.request.url, {
    method: 'PUT',
    headers: request.request.headers,
    body: stream,
    duplex: 'half',
  } as RequestInit);
  const updating = handleLiveUpdate(request, deps);
  await checked;
  await rotate({ owner: fresh });
  controller.enqueue(new TextEncoder().encode(JSON.stringify({ doc: doc(), baseRev: 1 })));
  controller.close();
  expect((await updating).status).toBe(401);
  expect((await (await get()).json()).rev).toBe(1);
});
it.each(['update', 'revoke'])(
  'GET 문서를 읽기 직전 %s가 일어나도 버전과 권한을 맞춘다',
  async (action) => {
    await create();
    await Promise.all(pending);
    const raw = db.prepare.bind(db);
    let changed = false;
    vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      const stmt = raw(sql);
      if (sql.startsWith('SELECT doc FROM')) {
        const bind = stmt.bind.bind(stmt);
        stmt.bind = (...values) => {
          const bound = bind(...values),
            first = bound.first.bind(bound);
          bound.first = async <T>() => {
            if (!changed) {
              changed = true;
              const next = doc();
              next.share.title = '동시 변경';
              await raw('UPDATE trip_shares SET doc = ?, rev = 2, view_token = ? WHERE id = ?')
                .bind(JSON.stringify(next), action === 'revoke' ? fresh : view, id)
                .run();
            }
            return first<T>();
          };
          return bound;
        };
      }
      return stmt;
    });
    const r = await get();
    if (action === 'revoke') expect(r.status).toBe(401);
    else expect(await r.json()).toMatchObject({ rev: 2, doc: { share: { title: '동시 변경' } } });
  },
);

it.each(['view', 'owner', 'delete'])(
  '인증 뒤 다른 기기가 소유자를 바꾸면 %s 변경도 막는다',
  async (action) => {
    await create();
    const raw = db.prepare.bind(db);
    let swapped = false;
    vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      const stmt = raw(sql);
      if (sql.includes('SELECT hash FROM trip_share_tokens')) {
        const bind = stmt.bind.bind(stmt);
        stmt.bind = (...values) => {
          const bound = bind(...values),
            first = bound.first.bind(bound);
          bound.first = async <T>() => {
            const value = await first<T>();
            if (value && !swapped) {
              swapped = true;
              await rotate({ owner: fresh });
            }
            return value;
          };
          return bound;
        };
      }
      return stmt;
    });
    const response =
      action === 'delete'
        ? await handleLiveDelete(ctx('DELETE', null, owner), deps)
        : await rotate(action === 'view' ? { view: 'z'.repeat(43) } : { owner: 'z'.repeat(43) });
    expect(response.status).toBe(401);
    expect((await get(fresh)).status).toBe(200);
  },
);

it('v1에서 v2로 올린 뒤 v1 PUT은 버전 오류이고 v2는 된다', async () => {
  await create();
  const v2 = { ...doc(), v: 2 };
  expect((await handleLiveUpdate(ctx('PUT', { doc: v2, baseRev: 1 }, owner), deps)).status).toBe(
    200,
  );
  const lower = await update(2);
  expect(lower.status).toBe(409);
  expect(await lower.json()).toMatchObject({ reason: 'version' });
  expect((await handleLiveUpdate(ctx('PUT', { doc: v2, baseRev: 2 }, owner), deps)).status).toBe(
    200,
  );
});
async function addCollabRows(shareId: string) {
  await db
    .prepare('INSERT INTO trip_collab_devices VALUES (?, ?, ?, ?, ?, ?)')
    .bind(shareId, 'device01', `해시${shareId}`, '시험 기기', now.toISOString(), now.toISOString())
    .run();
  await db
    .prepare('INSERT INTO trip_collab_meta (share_id, progress_rev) VALUES (?, 0)')
    .bind(shareId)
    .run();
  await db
    .prepare('INSERT INTO trip_progress VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(shareId, 'stop0001', 1, '2026-11-01', 'device01', '시험 기기', now.toISOString())
    .run();
}
it('공유 지우기는 함께 편집 기기·메타·진행도 지운다', async () => {
  await create();
  await Promise.all(pending);
  await addCollabRows(id);
  expect((await handleLiveDelete(ctx('DELETE', null, owner), deps)).status).toBe(204);
  for (const table of ['trip_collab_devices', 'trip_collab_meta', 'trip_progress'])
    expect(await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).toEqual({ n: 0 });
});
it('만료 정리는 만료된 함께 편집 자료만 지운다', async () => {
  await create();
  await Promise.all(pending);
  await addCollabRows(id);
  await db
    .prepare(
      'INSERT INTO trip_shares SELECT ?,doc,rev,view_token,source_trip_id,created_at,updated_at,? FROM trip_shares WHERE id = ?',
    )
    .bind('expired000', now.toISOString(), id)
    .run();
  await addCollabRows('expired000');
  expect(await pruneExpiredLive(db, now, 20)).toBe(1);
  for (const table of ['trip_collab_devices', 'trip_collab_meta', 'trip_progress'])
    expect(await db.prepare(`SELECT share_id FROM ${table}`).all()).toEqual({
      results: [{ share_id: id }],
    });
});
