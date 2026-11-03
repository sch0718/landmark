// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ensureSchema } from 'src/server/meet/db';
import {
  pushItems,
  pullChanges,
  parsePullQuery,
  parsePushBody,
  purgeTombstones,
  readMe,
  deleteAccountData,
  TOMBSTONE_KEEP_MS,
  DEVICE_MAX,
} from 'src/server/library-sync/library';
import type { SyncUser } from 'src/server/library-sync/auth';
import { createSqliteD1 } from '../../helpers/sqlite-d1';
import type { Place } from 'src/schema/library';
const now = Date.parse('2026-10-29T00:00:00.000Z');
const t = '2026-10-03T00:00:00.000Z';
const f = <T>(value: T, updatedAt = t) => ({ value, updatedAt });
const place = (id = 'place00001'): Place => ({
  id,
  source: { kind: 'pin' },
  name: f('장소'),
  address: '',
  lng: 127,
  lat: 37,
  category: f(null),
  memo: f('처음'),
  labelIds: f([]),
  saved: f(true),
  createdAt: t,
  deletedAt: null,
});
const user: SyncUser = {
  userId: 'user-a',
  sessionHash: 'hash-a',
  sessionId: 'session-a',
  provider: 'kakao',
  account: 'kakao:dev-me',
};
const other = { ...user, userId: 'user-b' };
const device = 'a'.repeat(16);
let db: ReturnType<typeof createSqliteD1>;
beforeEach(async () => {
  db = createSqliteD1();
  await ensureSchema(db);
});
afterEach(() => db.close());
const body = (docs: Place[], baseRev = 0, baseDeleted: boolean | null = null) => ({
  v: 1 as const,
  deviceId: device,
  items: docs.map((doc) => ({ kind: 'place' as const, id: doc.id, baseRev, baseDeleted, doc })),
});
const pull = (since = 0, after = '', limit = 500) =>
  pullChanges(db, user, { since, after, limit, deviceId: device }, now);
it('새 항목과 동일 내용 및 오래된 base 병합을 처리한다', async () => {
  const p = place();
  const first = await pushItems(db, user, body([p, place('place00002')]), now);
  expect(first.rev).toBe(1);
  expect(first.results[0]).not.toHaveProperty('doc');
  expect((await pushItems(db, user, body([p], 1, false), now)).rev).toBe(1);
  const changed = { ...p, memo: f('새 메모', '2026-10-05T00:00:00.000Z') };
  await pushItems(db, user, body([changed], 1, false), now);
  const old = { ...p, name: f('다른 이름', '2026-10-06T00:00:00.000Z') };
  const merged = await pushItems(db, user, body([old], 1, false), now);
  expect(merged.results[0]?.doc).toMatchObject({ memo: changed.memo, name: old.name });
  const replace = await pushItems(db, user, body([p], merged.rev, false), now);
  expect(replace.results[0]?.doc).toBeUndefined();
  await pushItems(db, other, body([{ ...p, memo: f('B') }]), now);
  expect((await readMe(db, user)).library.items).toBe(2);
});
it('묘비 시각은 서버 시각이며 복원하면 NULL이다', async () => {
  const p = place();
  await pushItems(db, user, body([{ ...p, deletedAt: t }]), now);
  expect((await db.prepare('SELECT deleted_at FROM library_items').first())?.deleted_at).toBe(now);
  await pushItems(db, user, body([p], 1, true), now);
  expect((await db.prepare('SELECT deleted_at FROM library_items').first())?.deleted_at).toBeNull();
});
it('형식·크기·미래 시각은 항목별로 거절한다', async () => {
  const p = place();
  const result = await pushItems(
    db,
    user,
    {
      v: 1,
      deviceId: device,
      items: [
        { kind: 'place', id: p.id, baseRev: 0, baseDeleted: null, doc: {} },
        {
          kind: 'place',
          id: 'place00002',
          baseRev: 0,
          baseDeleted: null,
          doc: { ...place('place00002'), memo: f('x'.repeat(200001)) },
        },
        {
          kind: 'place',
          id: 'place00003',
          baseRev: 0,
          baseDeleted: null,
          doc: { ...place('place00003'), memo: f('미래', new Date(now + 660000).toISOString()) },
        },
      ],
    },
    now,
  );
  expect(result.rejected.map((r) => r.reason)).toEqual(['invalid', 'too-large', 'clock']);
  expect(result.rev).toBe(0);
});
it('요청 매개변수와 중복 키를 엄격히 검사한다', () => {
  for (const query of ['?since=-1', '?limit=501', '?after=invalid', '?device=a', '?unknown=x'])
    expect(() => parsePullQuery(new URL('http://localhost/' + query))).toThrow();
  expect(() => parsePushBody(body([place(), place()]))).toThrow();
  expect(() => parsePushBody({ ...body([place()]), unknown: true })).toThrow();
  expect(() => parsePushBody(body(Array.from({ length: 101 }, () => place())))).toThrow();
});
it('같은 rev도 키 커서로 2개씩 끝까지 받고 기기 갱신을 줄인다', async () => {
  expect(JSON.parse(((await pull()) as { body: string }).body).items).toEqual([]);
  await pushItems(
    db,
    user,
    body(Array.from({ length: 5 }, (_, i) => place(`place0000${i + 1}`))),
    now,
  );
  let cursor = { rev: 0, key: '' };
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const result = JSON.parse(((await pull(cursor.rev, cursor.key, 2)) as { body: string }).body);
    ids.push(...result.items.map((x: { id: string }) => x.id));
    expect(typeof result.items[0].doc).toBe('object');
    cursor = result.next;
    expect(result.more).toBe(i < 2);
  }
  expect(ids).toHaveLength(5);
  const row = await db.prepare('SELECT last_sync_at FROM library_devices').first();
  await pullChanges(db, user, { since: 0, after: '', limit: 500, deviceId: device }, now + 1000);
  expect(await db.prepare('SELECT last_sync_at FROM library_devices').first()).toEqual(row);
  await db.prepare('UPDATE library_state SET purged_rev = 3').run();
  expect(await pull(1)).toEqual({ resync: 3 });
  expect(await pull(0)).toHaveProperty('body');
});
it('동시 쓰기를 재시도해 양쪽 필드를 보존한다', async () => {
  const p = place();
  await pushItems(db, user, body([p]), now);
  const batch = db.batch.bind(db);
  let first = true;
  vi.spyOn(db, 'batch').mockImplementation(async (stmts) => {
    if (first) {
      first = false;
      await batch([
        db.prepare('UPDATE library_state SET rev = 2 WHERE user_id = ?').bind(user.userId),
        db
          .prepare('UPDATE library_items SET rev = 2, doc = ? WHERE user_id = ?')
          .bind(
            JSON.stringify({ ...p, name: f('다른 기기', '2026-10-07T00:00:00.000Z') }),
            user.userId,
          ),
      ]);
    }
    return batch(stmts);
  });
  const result = await pushItems(
    db,
    user,
    body([{ ...p, memo: f('메모 수정', '2026-10-08T00:00:00.000Z') }], 1, false),
    now,
  );
  expect(result.results[0]?.doc).toMatchObject({
    name: { value: '다른 기기' },
    memo: { value: '메모 수정' },
  });
});
it('90일 정리는 여행 참조 장소를 남기고 계정 지우기는 다른 사용자를 남긴다', async () => {
  const p = place();
  await pushItems(
    db,
    user,
    body([
      { ...p, deletedAt: t },
      { ...place('place00002'), deletedAt: t },
      { ...place('place00003'), deletedAt: t },
    ]),
    now,
  );
  await db
    .prepare('UPDATE library_items SET deleted_at = ? WHERE user_id = ?')
    .bind(now - TOMBSTONE_KEEP_MS - 86400000, user.userId)
    .run();
  await db
    .prepare("UPDATE library_items SET deleted_at = ? WHERE item_id = 'place00003'")
    .bind(now - TOMBSTONE_KEEP_MS + 86400000)
    .run();
  await db
    .prepare(
      "INSERT INTO library_items VALUES (?, 'trip', 'trip000001', 2, '{}', 0, NULL, ',place00002,', ?, ?)",
    )
    .bind(user.userId, device, now)
    .run();
  expect(await purgeTombstones(db, user.userId, now)).toBe(1);
  expect((await db.prepare('SELECT purged_rev FROM library_state').first())?.purged_rev).toBe(1);
  await pushItems(db, other, body([p]), now);
  await deleteAccountData(db, user.userId);
  expect((await readMe(db, user)).library.items).toBe(0);
  expect((await readMe(db, other)).library.live).toBe(1);
});

it('인증 라우트는 사용자 한도·본문 상한·off에서도 계정 삭제를 지킨다', async () => {
  const { handleSync } = await import('src/server/library-sync/router');
  const { productionDeps } = await import('src/server/library-sync/env');
  const { createFakeSocial } = await import('src/server/library-sync/dev-fake-social');
  const { socialAuthorizeUrl, socialNonce } = await import('@sch0718/firebase-session/client');
  const { base64url } = await import('@sch0718/firebase-session/worker');
  const deps = productionDeps();
  deps.now = () => now;
  deps.log = () => {};
  const env = { DB: db, SYNC_DEV_FAKE_SOCIAL: '1', LIBRARY_SYNC: '' };
  const session: { value?: string } = {};
  const call = (path: string, method = 'GET', value?: unknown) =>
    handleSync(
      {
        request: new Request('http://localhost:8795/api/sync' + path, {
          method,
          headers: {
            Origin: 'http://localhost:8795',
            ...(session.value ? { 'X-Landmark-Session': session.value } : {}),
          },
          ...(value !== undefined
            ? { body: typeof value === 'string' ? value : JSON.stringify(value) }
            : {}),
        }),
        env,
        params: {},
        waitUntil: () => {},
      },
      deps,
    );
  const verifier = 'a'.repeat(43);
  const query = new URL(
    socialAuthorizeUrl('kakao', {
      clientId: 'dev-fake-kakao',
      redirectUri: 'http://localhost:8795/auth/callback',
      state: 'state',
      nonce: await socialNonce(verifier),
      codeChallenge: base64url(
        new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
      ),
    }),
  ).searchParams;
  query.set('provider', 'kakao');
  query.set('sub', 'me');
  query.set('result', 'ok');
  const approve = await createFakeSocial({ now: () => now }).handle(
    new Request('http://localhost:8795/api/sync/dev/fake-social/approve?' + query),
    ['http://localhost:8795/auth/callback'],
  );
  const callback = new URL(
    (await approve!.text()).match(/url=([^"<]+)/)![1]!.replaceAll('&amp;', '&'),
  );
  const logged = await call('/v1/session/social', 'POST', {
    provider: 'kakao',
    code: callback.searchParams.get('code'),
    codeVerifier: verifier,
    redirectUri: 'http://localhost:8795/auth/callback',
  });
  expect(logged.status).toBe(200);
  session.value = (await logged.json()).sessionId;
  expect((await call('/v1/library/push', 'POST', 'x'.repeat(1000001))).status).toBe(413);
  expect((await call('/v1/library/push', 'POST', body([place()]))).status).toBe(200);
  const me = await (await call('/v1/me')).json();
  expect(me.library.live).toBe(1);
  await call('/v1/library/changes?device=' + device);
  await db
    .prepare('INSERT OR REPLACE INTO rate_counters VALUES (?, 5000)')
    .bind(`sync-pull:${me.userId}:2026-10-29`)
    .run();
  expect((await call('/v1/library/changes')).status).toBe(429);
  expect((await call('/v1/account', 'DELETE', {})).status).toBe(422);
  env.LIBRARY_SYNC = 'off';
  expect((await call('/v1/account', 'DELETE', { confirm: 'delete' })).status).toBe(204);
  expect((await db.prepare('SELECT count(*) AS n FROM users').first())?.n).toBe(0);
  expect((await db.prepare('SELECT count(*) AS n FROM sessions').first())?.n).toBe(0);
  env.LIBRARY_SYNC = '';
  expect((await call('/v1/me')).status).toBe(401);
});
it('묘비 목록을 읽은 뒤 되살아난 행은 정리하지 않는다', async () => {
  const p = place();
  await pushItems(db, user, body([{ ...p, deletedAt: t }]), now);
  await db
    .prepare('UPDATE library_items SET deleted_at = ? WHERE user_id = ?')
    .bind(now - TOMBSTONE_KEEP_MS - 1, user.userId)
    .run();
  const batch = db.batch.bind(db);
  vi.spyOn(db, 'batch').mockImplementationOnce(async (statements) => {
    await db
      .prepare(
        'UPDATE library_items SET deleted = 0, deleted_at = NULL, rev = rev + 1 WHERE user_id = ?',
      )
      .bind(user.userId)
      .run();
    return batch(statements);
  });
  expect(await purgeTombstones(db, user.userId, now)).toBe(0);
  expect((await readMe(db, user)).library.live).toBe(1);
});
it('상한을 넘기는 새 항목·커지는 수정만 too-large로 거절하고 줄이는 수정·삭제는 받는다', async () => {
  const quota = { items: 2, bytes: 1_000_000 };
  const a = place('place00001');
  const b = place('place00002');
  const c = place('place00003');
  const first = await pushItems(db, user, body([a, b, c]), now, quota);
  expect(first.results.map((r) => r.id)).toEqual(['place00001', 'place00002']);
  expect(first.rejected).toEqual([{ kind: 'place', id: 'place00003', reason: 'too-large' }]);
  // 다른 사용자는 따로 센다.
  expect((await pushItems(db, other, body([c]), now, quota)).rejected).toEqual([]);
  const stored = await db
    .prepare('SELECT sum(length(CAST(doc AS BLOB))) AS bytes FROM library_items WHERE user_id = ?')
    .bind(user.userId)
    .first<{ bytes: number }>();
  const tight = { items: 10, bytes: stored!.bytes };
  const longer = { ...a, memo: f('처음보다 긴 메모', '2026-10-04T00:00:00.000Z') };
  expect((await pushItems(db, user, body([longer], 1), now, tight)).rejected).toHaveLength(1);
  const shorter = { ...a, memo: f('', '2026-10-04T00:00:00.000Z') };
  const deleted = { ...b, deletedAt: '2026-10-04T00:00:00.000Z' };
  const ok = await pushItems(db, user, body([shorter, deleted], 1), now, tight);
  expect(ok.rejected).toEqual([]);
  expect(ok.results).toHaveLength(2);
  // 묘비라도 시각 몇 개보다 크게 커지면 상한을 적용한다.
  const bigTombstone = { ...deleted, memo: f('긴'.repeat(100), '2026-10-05T00:00:00.000Z') };
  expect((await pushItems(db, user, body([bigTombstone], 2), now, tight)).rejected).toHaveLength(1);
  // 이미 묘비인 항목을 조금씩 키우는 수정은 면제하지 않는다.
  const grownTombstone = { ...deleted, memo: f('조금'.repeat(10), '2026-10-05T00:00:00.000Z') };
  expect((await pushItems(db, user, body([grownTombstone], 2), now, tight)).rejected).toHaveLength(
    1,
  );
});
it('같은 묶음에서 줄어드는 수정의 절약분을 늘어나는 항목에 쓸 수 있다', async () => {
  const a = { ...place('place00001'), memo: f('아주 긴 처음 메모입니다') };
  const b = place('place00002');
  await pushItems(db, user, body([a, b]), now);
  const stored = await db
    .prepare('SELECT sum(length(CAST(doc AS BLOB))) AS bytes FROM library_items WHERE user_id = ?')
    .bind(user.userId)
    .first<{ bytes: number }>();
  const later = '2026-10-04T00:00:00.000Z';
  const reply = await pushItems(
    db,
    user,
    body(
      [
        { ...a, memo: f('', later) },
        { ...b, memo: f('처음보다 긴', later) },
      ],
      1,
    ),
    now,
    { items: 10, bytes: stored!.bytes },
  );
  expect(reply.rejected).toEqual([]);
});
it('기기 행은 사용자당 DEVICE_MAX개까지만 새로 만들고 있던 기기는 계속 갱신한다', async () => {
  await pushItems(db, user, body([place()]), now);
  const pullAs = (deviceId: string, at = now) =>
    pullChanges(db, user, { since: 0, after: '', limit: 500, deviceId }, at);
  for (let i = 0; i < DEVICE_MAX + 2; i++) await pullAs(i.toString(16).padStart(16, '0'));
  const count = () =>
    db.prepare('SELECT count(*) AS n FROM library_devices').first<{ n: number }>();
  expect((await count())?.n).toBe(DEVICE_MAX);
  await pullAs('0'.repeat(16), now + 2 * 60 * 60 * 1000);
  expect(
    await db
      .prepare('SELECT last_sync_at AS at FROM library_devices WHERE device_id = ?')
      .bind('0'.repeat(16))
      .first(),
  ).toEqual({ at: now + 2 * 60 * 60 * 1000 });
});
it('개수 상한은 행을 더할 때만 보고, 묘비 면제분은 다른 항목의 여유로 쓰지 않는다', async () => {
  const a = place('place00001');
  const b = place('place00002');
  await pushItems(db, user, body([a, b]), now);
  const later = '2026-10-04T00:00:00.000Z';
  const longer = { ...a, memo: f('처음보다 긴 메모', later) };
  // 이미 개수 상한을 넘은 계정도 있던 항목 수정은 바이트 여유 안에서 받는다.
  expect(
    (await pushItems(db, user, body([longer], 1), now, { items: 1, bytes: 1_000_000 })).rejected,
  ).toEqual([]);
  const stored = await db
    .prepare('SELECT sum(length(CAST(doc AS BLOB))) AS bytes FROM library_items WHERE user_id = ?')
    .bind(user.userId)
    .first<{ bytes: number }>();
  const deleted = { ...b, deletedAt: later };
  const grown = { ...longer, memo: f('처음보다 긴 메모에 몇 글자', '2026-10-05T00:00:00.000Z') };
  const reply = await pushItems(db, user, body([deleted, grown], 2), now, {
    items: 10,
    bytes: stored!.bytes,
  });
  expect(reply.rejected).toEqual([{ kind: 'place', id: 'place00001', reason: 'too-large' }]);
  expect(reply.results.map((r) => r.id)).toEqual(['place00002']);
});
