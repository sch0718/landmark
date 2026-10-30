// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writeBackup, type BackupBody } from 'src/server/library-sync/backup';
import { createSyncMemoryServer } from '../../helpers/sync-memory-server';

let server: ReturnType<typeof createSyncMemoryServer>;
let session: string;
function validBody(over: Partial<BackupBody> = {}): BackupBody {
  return {
    v: 1,
    format: 1,
    data: gzipSync(Buffer.from('{"format":"tripmap-backup"}')).toString('base64'),
    rawBytes: 27,
    contentHash: 'abc123',
    counts: { places: 3, labels: 1, trips: 0, meetings: 0 },
    exportedAt: '2026-10-29T00:00:00.000Z',
    deviceId: 'abcdefgh12345678',
    deviceLabel: '시험 기기',
    reason: 'manual',
    ...over,
  };
}
function request(method = 'GET', body?: unknown, suffix = '', sid = session) {
  return server.fetch('http://localhost:8796/api/sync/v1/backup' + suffix, {
    method,
    headers: {
      Origin: 'http://localhost:8796',
      'X-Landmark-Session': sid,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(async () => {
  server = createSyncMemoryServer({ ALLOWED_ACCOUNTS: 'kakao:dev-me,kakao:dev-you' });
  session = await server.login();
});
afterEach(() => {
  vi.restoreAllMocks();
  server.db.close();
});
it('메타가 없고 쓰기 뒤 메타와 압축 크기가 일치한다', async () => {
  expect(await (await request()).json()).toEqual({
    now: expect.any(Number),
    writable: true,
    maxStoredBytes: 1048576,
    backup: null,
  });
  const body = validBody();
  const res = await request('POST', body);
  expect(res.status).toBe(200);
  const { backup } = await res.json();
  expect(backup).toMatchObject({
    id: expect.stringMatching(/^[0-9a-f]{16}$/),
    storedBytes: Buffer.from(body.data, 'base64').length,
    reason: 'manual',
    counts: body.counts,
  });
  expect((await (await request()).json()).backup).toEqual(backup);
});
it('큰 압축 자료를 조각 셋으로 나누고 그대로 읽고 덮어쓴다', async () => {
  const body = validBody({ data: gzipSync(randomBytes(900000)).toString('base64') });
  const first = (await (await request('POST', body)).json()).backup;
  expect(
    (await server.db.prepare('SELECT COUNT(*) AS n FROM library_backup_parts').first())?.n,
  ).toBe(3);
  expect(await (await request('GET', undefined, '/data?id=' + first.id)).json()).toEqual({
    id: first.id,
    data: body.data,
  });
  const next = (await (await request('POST', validBody())).json()).backup;
  expect(
    (await server.db.prepare('SELECT backup_id FROM library_backup_parts').all()).results,
  ).toEqual([{ backup_id: next.id }]);
  expect((await server.db.prepare('SELECT COUNT(*) AS n FROM library_backups').first())?.n).toBe(1);
});
it('조건부 쓰기의 승자 자료만 남는다', async () => {
  const first = (await (await request('POST', validBody({ ifMatch: null }))).json()).backup;
  for (const ifMatch of [null, '0000000000000000']) {
    const res = await request('POST', validBody({ ifMatch }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'backup-changed' });
    expect(
      (await server.db.prepare('SELECT DISTINCT backup_id FROM library_backup_parts').all())
        .results,
    ).toEqual([{ backup_id: first.id }]);
  }
  expect((await request('POST', validBody({ ifMatch: first.id }))).status).toBe(200);
});
it('없는 자료와 바뀐 자료, 잘못된 질의를 구분한다', async () => {
  expect((await request('GET', undefined, '/data')).status).toBe(404);
  for (const suffix of ['/data?x=1', '/data?id=XYZ'])
    expect((await request('GET', undefined, suffix)).status).toBe(422);
  await request('POST', validBody());
  expect((await request('GET', undefined, '/data?id=0000000000000000')).status).toBe(409);
  await server.db.prepare('DELETE FROM library_backup_parts').run();
  expect((await request('GET', undefined, '/data')).status).toBe(409);
});
const invalid: [string, unknown][] = [
  ['extra', { extra: 1 }],
  ['v', { v: 2 }],
  ['format', { format: 2 }],
  ['data', { data: 'AAAA' }],
  ['data', { data: 'H4sI!!!!' }],
  ['data', { data: 'H4sIA' }],
  ...[0, 16777217, 1.5].map((rawBytes): [string, unknown] => ['rawBytes', { rawBytes }]),
  ['contentHash', { contentHash: 'A!' }],
  ['counts.places', { counts: { places: -1, labels: 0, trips: 0, meetings: 0 } }],
  ['counts.extra', { counts: { places: 0, labels: 0, trips: 0, meetings: 0, extra: 1 } }],
  ['exportedAt', { exportedAt: 'x' }],
  ['deviceId', { deviceId: 'short' }],
  ...['', 'a'.repeat(41), 'a\nb'].map((deviceLabel): [string, unknown] => [
    'deviceLabel',
    { deviceLabel },
  ]),
  ['reason', { reason: 'cron' }],
  ['ifMatch', { ifMatch: 'nothex' }],
];
it.each(invalid)('본문의 %s 오류를 거절한다: %j', async (path, over) => {
  const res = await request('POST', { ...validBody(), ...(over as object) });
  expect(res.status).toBe(422);
  expect(await res.json()).toEqual({ error: 'invalid', path });
});
it('자료와 본문의 크기 상한을 지킨다', async () => {
  for (const over of [{ data: 'H4sI' + 'A'.repeat(1398104) }, { extra: 'A'.repeat(1500001) }]) {
    const res = await request('POST', { ...validBody(), ...over });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'too-large' });
  }
});
it('사용자 격리와 지우기, 계정 지우기를 지킨다', async () => {
  const other = await server.login('you');
  await request('POST', validBody());
  expect((await (await request('GET', undefined, '', other)).json()).backup).toBeNull();
  await request('POST', validBody(), '', other);
  expect((await request('DELETE')).status).toBe(204);
  expect((await (await request()).json()).backup).toBeNull();
  await request('POST', validBody());
  const res = await server.fetch('http://localhost:8796/api/sync/v1/account', {
    method: 'DELETE',
    headers: { 'X-Landmark-Session': session },
    body: JSON.stringify({ confirm: 'delete' }),
  });
  expect(res.status).toBe(204);
  for (const table of ['library_backups', 'library_backup_parts'])
    expect((await server.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first())?.n).toBe(1);
});
it('하루 쓰기와 메타·자료 합산 읽기 한도를 지킨다', async () => {
  for (let i = 0; i < 20; i++) expect((await request('POST', validBody())).status).toBe(200);
  expect((await request('POST', validBody())).status).toBe(429);
  for (let i = 0; i < 200; i++)
    expect((await request('GET', undefined, i % 2 ? '/data' : '')).status).toBe(200);
  expect((await request()).status).toBe(429);
});
it.each(['AUTO_BACKUP', 'LIBRARY_SYNC'] as const)(
  '%s가 꺼져도 읽기·지우기를 남긴다',
  async (flag) => {
    await request('POST', validBody());
    const { handleSync } = await import('src/server/library-sync/router');
    const { productionDeps } = await import('src/server/library-sync/env');
    const deps = productionDeps();
    deps.log = () => {};
    const call = (method: string, suffix = '') =>
      handleSync(
        {
          request: new Request('http://localhost:8796/api/sync/v1/backup' + suffix, {
            method,
            headers: { Origin: 'http://localhost:8796', 'X-Landmark-Session': session },
          }),
          env: {
            DB: server.db,
            SYNC_DEV_FAKE_SOCIAL: '1',
            [flag]: 'off',
            ALLOWED_ACCOUNTS: 'kakao:dev-me',
          },
          params: {},
          waitUntil: () => {},
        },
        deps,
      );
    expect((await call('POST')).status).toBe(503);
    expect((await (await call('GET')).json()).writable).toBe(false);
    expect((await call('GET', '/data')).status).toBe(200);
    expect((await call('DELETE')).status).toBe(204);
  },
);
it('세션이 없으면 거절한다', async () => {
  expect((await request('GET', undefined, '', '')).status).toBe(401);
});
it('요청의 계정 경계와 실제 세션 계정이 다르면 쓰지 않는다', async () => {
  await request('POST', validBody());
  const owner = await server.db
    .prepare('SELECT user_id FROM library_backups')
    .first<{ user_id: string }>();
  const other = await server.login('you');
  const response = await server.fetch('http://localhost:8796/api/sync/v1/backup', {
    method: 'POST',
    headers: { 'X-Landmark-Session': other, 'X-Landmark-Backup-User': owner!.user_id },
    body: JSON.stringify(validBody({ ifMatch: null })),
  });
  expect(response.status).toBe(401);
  expect((await server.db.prepare('SELECT COUNT(*) AS n FROM library_backups').first())?.n).toBe(1);
});

it('수동 쓰기 직후 다른 쓰기가 덮어써도 완료한 트랜잭션은 성공으로 응답한다', async () => {
  await request('POST', validBody());
  const owner = await server.db
    .prepare('SELECT user_id FROM library_backups')
    .first<{ user_id: string }>();
  const batch = server.db.batch.bind(server.db);
  const laterId = 'ffffffffffffffff';
  const laterBody = validBody({
    contentHash: 'later',
    counts: { places: 7, labels: 2, trips: 0, meetings: 0 },
  });
  const spy = vi.spyOn(server.db, 'batch').mockImplementationOnce(async (stmts) => {
    const results = await batch(stmts);
    spy.mockRestore();
    await writeBackup(server.db, owner!.user_id, laterBody, laterId, Date.now() + 1000);
    return results;
  });
  const body = validBody({ contentHash: 'mine' });
  const response = await request('POST', body);
  expect(response.status).toBe(200);
  const { backup } = await response.json();
  expect(backup).toMatchObject({ contentHash: body.contentHash, counts: body.counts });
  expect(backup.id).not.toBe(laterId);
  expect((await (await request()).json()).backup).toMatchObject({
    id: laterId,
    contentHash: laterBody.contentHash,
  });
});
it.each(
  ['', '/data'].flatMap((suffix) =>
    (['same-origin', 'none', 'same-site', 'cross-site', undefined] as const).map((site) => ({
      suffix,
      site,
      status: site === 'same-origin' || site === 'none' ? 200 : 403,
    })),
  ),
)('GET /v1/backup$suffix의 출처 없는 $site 요청은 $status', async ({ suffix, site, status }) => {
  await request('POST', validBody());
  const headers = new Headers({ 'X-Landmark-Session': session });
  if (site !== undefined) headers.set('Sec-Fetch-Site', site);
  const incoming = new Request('http://localhost:8796/api/sync/v1/backup' + suffix, { headers });
  expect(incoming.headers.has('Origin')).toBe(false);
  expect(incoming.headers.has('Referer')).toBe(false);
  // fetch 도우미가 Origin을 붙이지 못하도록 실제 라우터 진입점을 직접 부른다.
  const response = await server.handle(incoming);
  expect(response?.status).toBe(status);
  if (status === 403) expect(await response!.json()).toEqual({ error: 'origin' });
  else if (suffix === '/data')
    expect(await response!.json()).toMatchObject({ data: validBody().data });
  else
    expect(await response!.json()).toMatchObject({
      writable: true,
      backup: { counts: validBody().counts },
    });
});
