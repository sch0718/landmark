// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleLiveCreate, handleLiveUpdate } from 'src/server/trip-live/handlers';
import {
  handleCollabAccept,
  handleCollabInviteCancel,
  handleCollabInviteCreate,
  handleCollabInvitePreview,
  handleCollabMembers,
  handleCollabProgress,
  handleCollabPutDoc,
  handleCollabRemoveMember,
  handleCollabState,
} from 'src/server/trip-collab/handlers';
import { resetSchemaMemo } from 'src/server/meet/db';
import type { MeetContext } from 'src/server/meet/env';
import { hashToken } from 'src/server/meet/tokens';
import { createSqliteD1 } from '../../helpers/sqlite-d1';
import { buildLiveDoc } from '../../fixtures/live-trip';
const id = 'abcdefghij',
  owner = 'o'.repeat(43),
  view = 'v'.repeat(43),
  invite = 'i'.repeat(43),
  device = 'd'.repeat(43);
let db: ReturnType<typeof createSqliteD1>, pending: Promise<unknown>[], now: Date;
const deps = { now: () => now, fetch: vi.fn<typeof fetch>() };
const doc = () => ({ ...buildLiveDoc(), v: 2 as const });
function ctx(
  method: string,
  token = owner,
  body?: unknown,
  suffix = '',
  env: Partial<MeetContext['env']> = {},
  params: Record<string, string> = {},
): MeetContext {
  return {
    request: new Request(`http://localhost:8788/api/trip-collab/${id}${suffix}`, {
      method,
      headers: {
        Origin: 'http://localhost:8788',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env: { DB: db, ...env },
    params: { id, ...params },
    waitUntil: (p) => {
      pending.push(p);
    },
  };
}
async function setup(v = 2) {
  const input = {
    id,
    sourceTripId: 'trip000001',
    ownerToken: owner,
    viewToken: view,
    turnstile: 'dev',
    doc: buildLiveDoc(),
  };
  expect((await handleLiveCreate(ctx('POST', owner, input), deps)).status).toBe(201);
  await Promise.all(pending);
  if (v === 2)
    expect(
      (await handleLiveUpdate(ctx('PUT', owner, { doc: doc(), baseRev: 1 }), deps)).status,
    ).toBe(200);
  await Promise.all(pending);
}
const createInvite = (token = invite, env = {}) =>
  handleCollabInviteCreate(ctx('POST', owner, { token, label: ' 민지 ' }, '', env), deps);
const accept = (token = device, invitation = invite, label = '민지 폰', env = {}) =>
  handleCollabAccept(ctx('POST', invitation, { deviceToken: token, label }, '', env), deps);
const state = (token = device, query = '') =>
  handleCollabState(ctx('GET', token, undefined, query), deps);
async function join() {
  await setup();
  await createInvite();
  const r = await accept();
  expect(r.status).toBe(201);
  return (await r.json()) as { deviceId: string; rev: number };
}
const op = (extra = {}) => ({
  stopId: 'stop0001',
  visited: true,
  date: '2026-11-01',
  at: now.toISOString(),
  ...extra,
});
const progress = (body: unknown, token = device, env = {}) =>
  handleCollabProgress(ctx('POST', token, body, '', env), deps);
beforeEach(() => {
  resetSchemaMemo();
  db = createSqliteD1();
  pending = [];
  now = new Date('2026-11-01T00:00:00.000Z');
});
afterEach(async () => {
  await Promise.all(pending);
  vi.restoreAllMocks();
  db.close();
});
describe('편집 초대', () => {
  it('소유자가 초대를 만들면 해시와 7일 기한만 저장하고 재시도는 같은 초대다', async () => {
    await setup();
    const r = await createInvite();
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body).toMatchObject({ created: true, expiresAt: '2026-11-08T00:00:00.000Z' });
    const row = await db
      .prepare("SELECT hash,kind,label FROM trip_share_tokens WHERE kind = 'invite'")
      .first();
    expect(row).toEqual({ hash: await hashToken(invite), kind: 'invite', label: '민지' });
    expect(body.key).toBe((await hashToken(invite)).slice(0, 16));
    const retry = await createInvite();
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ created: false, key: body.key });
    expect(
      await db
        .prepare('SELECT count(*) AS n FROM trip_share_tokens WHERE hash = ?')
        .bind(invite)
        .first(),
    ).toEqual({ n: 0 });
  });
  it('만료된 같은 토큰은 새 초대로 만들고 새 기한으로 미리보기와 수락을 허용한다', async () => {
    await setup();
    const first = await (await createInvite()).json();
    expect(first.expiresAt).toBe('2026-11-08T00:00:00.000Z');
    await Promise.all(pending);
    now = new Date(first.expiresAt);
    expect(
      await db.prepare("SELECT expires_at FROM trip_share_tokens WHERE kind = 'invite'").first(),
    ).toEqual({ expires_at: first.expiresAt });

    const renewed = await createInvite();
    expect(renewed.status).toBe(201);
    const body = await renewed.json();
    expect(body).toEqual({
      key: first.key,
      created: true,
      expiresAt: '2026-11-15T00:00:00.000Z',
    });
    expect(
      await db
        .prepare("SELECT created_at, expires_at FROM trip_share_tokens WHERE kind = 'invite'")
        .all(),
    ).toMatchObject({
      results: [{ created_at: now.toISOString(), expires_at: body.expiresAt }],
    });
    const preview = await handleCollabInvitePreview(ctx('GET', invite), deps);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ title: '시험 여행', expiresAt: body.expiresAt });
    const accepted = await accept();
    expect(accepted.status).toBe(201);
    expect(await accepted.json()).toMatchObject({ deviceId: expect.any(String), rev: 2 });
    expect((await state()).status).toBe(200);
    expect((await accept('x'.repeat(43))).status).toBe(401);
  });
  it('공유 기한이 먼저이면 그때 초대도 끝난다', async () => {
    await setup();
    await db
      .prepare('UPDATE trip_shares SET expires_at = ?')
      .bind('2026-11-03T00:00:00.000Z')
      .run();
    expect(await (await createInvite()).json()).toMatchObject({
      expiresAt: '2026-11-03T00:00:00.000Z',
    });
  });
  it('v1 공동본은 먼저 업그레이드해야 한다', async () => {
    await setup(1);
    const r = await createInvite();
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ reason: 'upgrade' });
  });
  it('기다리는 초대는 10개까지다', async () => {
    await setup();
    for (let i = 0; i < 10; i++)
      expect((await createInvite(String(i).repeat(43))).status).toBe(201);
    const r = await createInvite();
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ reason: 'full' });
  });
  it('보기·편집 토큰은 초대를 만들 수 없고 61번째 요청은 한도를 넘는다', async () => {
    await join();
    for (const token of [view, device])
      expect(
        (
          await handleCollabInviteCreate(
            ctx('POST', token, { token: 'z'.repeat(43), label: null }),
            deps,
          )
        ).status,
      ).toBe(401);
    await db.prepare("DELETE FROM rate_counters WHERE key LIKE 'collabInvite:%'").run();
    for (let i = 0; i < 60; i++)
      expect((await createInvite()).status).toBe(201 + (i === 0 ? 0 : -1));
    expect((await createInvite()).status).toBe(429);
  });
  it.each(['TRIP_COLLAB', 'TRIP_SHARE_LIVE'])('%s가 꺼지면 초대와 수락을 막는다', async (key) => {
    await setup();
    for (const r of [
      await createInvite(invite, { [key]: 'off' }),
      await accept(device, invite, '기기', { [key]: 'off' }),
    ]) {
      expect(r.status).toBe(503);
      expect(await r.json()).toMatchObject({ reason: 'off' });
    }
  });
  it('미리보기는 제목·기간·기한만 주고 틀린 초대 읽기만 센다', async () => {
    await setup();
    await createInvite();
    const r = await handleCollabInvitePreview(ctx('GET', invite), deps);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      title: '시험 여행',
      startDate: '2026-12-09',
      endDate: '2026-12-10',
      expiresAt: '2026-11-08T00:00:00.000Z',
    });
    expect(
      await db
        .prepare("SELECT count(*) AS n FROM rate_counters WHERE key LIKE 'collabRead:%'")
        .first(),
    ).toEqual({ n: 0 });
    await accept();
    const used = await handleCollabInvitePreview(ctx('GET', invite), deps);
    expect(used.status).toBe(401);
    expect(await used.json()).toMatchObject({ reason: 'invite' });
    expect(
      await db.prepare("SELECT count FROM rate_counters WHERE key LIKE 'collabRead:%'").first(),
    ).toEqual({ count: 1 });
  });
  it('지난 초대는 미리보기와 수락을 막는다', async () => {
    await setup();
    await createInvite();
    now = new Date('2026-11-09T00:00:00.000Z');
    for (const r of [await handleCollabInvitePreview(ctx('GET', invite), deps), await accept()]) {
      expect(r.status).toBe(401);
      expect(await r.json()).toMatchObject({ reason: 'invite' });
    }
  });
});
describe('초대 수락과 권한', () => {
  it('1회 수락 뒤 초대는 사라지고 같은 편집 토큰 재시도만 같은 기기를 받는다', async () => {
    const joined = await join();
    expect(joined.deviceId).toMatch(/^[a-z0-9]{8}$/);
    expect(
      await db.prepare("SELECT count(*) AS n FROM trip_share_tokens WHERE kind = 'invite'").first(),
    ).toEqual({ n: 0 });
    expect(await db.prepare('SELECT count(*) AS n FROM trip_collab_devices').first()).toEqual({
      n: 1,
    });
    const second = await accept('x'.repeat(43));
    expect(second.status).toBe(401);
    expect(await second.json()).toMatchObject({ reason: 'invite' });
    const retry = await accept();
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(joined);
  });
  it('21번째 기기는 full이고 빈 이름·초대와 같은 편집 토큰은 잘못된 입력이다', async () => {
    await setup();
    await createInvite();
    expect((await accept(device, invite, '')).status).toBe(400);
    expect((await accept(invite)).status).toBe(400);
    for (let i = 0; i < 20; i++)
      await db
        .prepare('INSERT INTO trip_collab_devices VALUES (?, ?, ?, ?, ?, ?)')
        .bind(
          id,
          `d${String(i).padStart(7, '0')}`,
          `시험해시${i}`,
          '기기',
          now.toISOString(),
          now.toISOString(),
        )
        .run();
    const r = await accept();
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ reason: 'full' });
  });
  it('소유자와 편집 기기는 공동본을 읽고 보기 토큰은 못 읽는다', async () => {
    const joined = await join();
    const editor = await state();
    expect(editor.status).toBe(200);
    expect(editor.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await editor.json()).toMatchObject({
      role: 'editor',
      deviceId: joined.deviceId,
      members: 1,
      editedBy: null,
      doc: { v: 2 },
      progress: { prev: 0, marks: [], next: null },
    });
    expect(await (await state(owner)).json()).toMatchObject({ role: 'owner', deviceId: null });
    expect((await state(view)).status).toBe(401);
  });
  it('같은 rev·prev는 문서를 읽지 않고 304, 한쪽만 다르면 그 부분만 보낸다', async () => {
    await join();
    const spy = vi.spyOn(db, 'prepare');
    const r = await state(device, '?rev=2&prev=0');
    expect(r.status).toBe(304);
    expect(await r.text()).toBe('');
    expect(spy.mock.calls.some(([sql]) => sql.startsWith('SELECT doc'))).toBe(false);
    const onlyProgress = await (await state(device, '?rev=2')).json();
    expect(onlyProgress).not.toHaveProperty('doc');
    expect(onlyProgress).toHaveProperty('progress');
    const onlyDoc = await (await state(device, '?prev=0')).json();
    expect(onlyDoc).toHaveProperty('doc');
    expect(onlyDoc).not.toHaveProperty('progress');
  });
  it('seen_at은 1시간 지나야 갱신하며 같은 버전 확인도 접속으로 센다', async () => {
    await join();
    const initial = now.toISOString();
    now = new Date('2026-11-01T00:30:00.000Z');
    await state();
    expect(await db.prepare('SELECT seen_at FROM trip_collab_devices').first()).toEqual({
      seen_at: initial,
    });
    now = new Date('2026-11-01T02:00:00.000Z');
    await state(device, '?rev=2&prev=0');
    expect(await db.prepare('SELECT seen_at FROM trip_collab_devices').first()).toEqual({
      seen_at: now.toISOString(),
    });
  });
  it('없는 공유·만료 공유는 각각 404·410이고 그 읽기만 센다', async () => {
    expect((await state()).status).toBe(404);
    await setup();
    await db.prepare('UPDATE trip_shares SET expires_at = ?').bind(now.toISOString()).run();
    expect((await state(owner)).status).toBe(410);
    expect(
      await db.prepare("SELECT count FROM rate_counters WHERE key LIKE 'collabRead:%'").first(),
    ).toEqual({ count: 2 });
  });
});
describe('공동본 쓰기', () => {
  it('편집 기기가 올리면 revision과 마지막 편집 기기 이름이 바뀐다', async () => {
    await join();
    const next = doc();
    next.share.title = '새 제목';
    const r = await handleCollabPutDoc(ctx('PUT', device, { doc: next, baseRev: 2 }), deps);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ rev: 3 });
    expect(await (await state()).json()).toMatchObject({
      editedBy: '민지 폰',
      doc: { share: { title: '새 제목' } },
    });
    expect(await db.prepare('SELECT edited_at FROM trip_collab_meta').first()).toEqual({
      edited_at: now.toISOString(),
    });
  });
  it('낡은 revision·v1·더 최신 저장 버전·꺼짐·크기를 구분한다', async () => {
    await join();
    const put = (value: unknown, baseRev = 2, env = {}) =>
      handleCollabPutDoc(ctx('PUT', device, { doc: value, baseRev }, '', env), deps);
    const conflict = await put(doc(), 1);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ rev: 2 });
    const invalid = await put(buildLiveDoc());
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ reason: 'doc' });
    expect((await put(doc(), 2, { TRIP_SHARE_LIVE: 'off' })).status).toBe(503);
    const large = doc();
    large.share.places[0]!.memo = '가'.repeat(180_000);
    expect((await put(large)).status).toBe(413);
    await db.prepare("UPDATE trip_shares SET doc = json_set(doc, '$.v', 3)").run();
    const version = await put(doc());
    expect(version.status).toBe(409);
    expect(await version.json()).toMatchObject({ reason: 'version' });
  });
});
describe('공동 진행 쓰기', () => {
  it('체크·더 이른 변경 무시·미래 시각 자르기·풀기를 처리한다', async () => {
    await join();
    const first = await progress({ ops: [op()] });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      prev: 1,
      marks: [{ stopId: 'stop0001', by: { label: '민지 폰' }, at: now.toISOString() }],
    });
    expect(
      await (
        await progress({ ops: [op({ visited: false, at: '2026-10-31T23:00:00.000Z' })] })
      ).json(),
    ).toMatchObject({ prev: 2, marks: [{ stopId: 'stop0001' }] });
    now = new Date('2026-11-01T01:00:00.000Z');
    expect(
      await (await progress({ ops: [op({ at: '2026-12-01T00:00:00.000Z' })] })).json(),
    ).toMatchObject({ marks: [{ at: now.toISOString() }] });
    now = new Date('2026-11-01T02:00:00.000Z');
    expect(await (await progress({ ops: [op({ visited: false })] })).json()).toMatchObject({
      marks: [],
    });
  });
  it('다음 장소는 늦은 값만 남기고 소유자 체크는 만든 사람이다', async () => {
    await join();
    const next = { stopId: 'stop0002', date: '2026-11-01', at: now.toISOString() };
    expect(await (await progress({ ops: [], next })).json()).toMatchObject({
      next: { ...next, label: '민지 폰' },
    });
    expect(
      await (
        await progress({ ops: [], next: { ...next, stopId: null, at: '2026-10-31T23:00:00.000Z' } })
      ).json(),
    ).toMatchObject({ next: { stopId: 'stop0002' } });
    expect(await (await progress({ ops: [op()] }, owner)).json()).toMatchObject({
      marks: [{ by: { device: 'owner', label: '만든 사람' } }],
    });
  });
  it('진행은 50개·16384바이트까지이고 2001번째 새 행은 거절한다', async () => {
    await join();
    expect((await progress({ ops: [] })).status).toBe(400);
    expect((await progress({ ops: Array.from({ length: 51 }, () => op()) })).status).toBe(400);
    const tooLarge = ctx('POST', device, { ops: [op()] });
    tooLarge.request.headers.set('Content-Length', '16385');
    expect((await handleCollabProgress(tooLarge, deps)).status).toBe(413);
    for (let i = 0; i < 2000; i++)
      await db
        .prepare('INSERT INTO trip_progress VALUES (?, ?, 0, ?, ?, ?, ?)')
        .bind(
          id,
          `s${String(i).padStart(7, '0')}`,
          '2026-11-01',
          'owner',
          '만든 사람',
          now.toISOString(),
        )
        .run();
    const full = await progress({ ops: [op()] });
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ reason: 'full' });
  });
  it('공동 진행은 TRIP_COLLAB만 보고 갱신 공유 스위치에는 영향받지 않는다', async () => {
    await join();
    expect((await progress({ ops: [op()] }, device, { TRIP_COLLAB: 'off' })).status).toBe(503);
    expect((await progress({ ops: [op()] }, device, { TRIP_SHARE_LIVE: 'off' })).status).toBe(200);
  });
});
describe('참여 기기 관리', () => {
  it('소유자만 목록을 읽고 거둔 기기의 모든 편집 요청은 막힌다', async () => {
    const joined = await join();
    await createInvite();
    const r = await handleCollabMembers(ctx('GET'), deps);
    expect(await r.json()).toMatchObject({
      devices: [{ deviceId: joined.deviceId, label: '민지 폰' }],
      invites: [{ label: '민지' }],
    });
    expect((await handleCollabMembers(ctx('GET', device), deps)).status).toBe(401);
    expect(
      (
        await handleCollabRemoveMember(
          ctx('DELETE', device, undefined, '', {}, { device: joined.deviceId }),
          deps,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handleCollabRemoveMember(
          ctx('DELETE', owner, undefined, '', {}, { device: joined.deviceId }),
          deps,
        )
      ).status,
    ).toBe(204);
    expect((await state()).status).toBe(401);
    expect(
      (await handleCollabPutDoc(ctx('PUT', device, { doc: doc(), baseRev: 2 }), deps)).status,
    ).toBe(401);
  });
  it('꺼져도 읽기·초대 취소·기기 거두기·그만두기를 허용한다', async () => {
    const joined = await join();
    const invitation = await (await createInvite()).json();
    const off = { TRIP_COLLAB: 'off', TRIP_SHARE_LIVE: 'off' };
    expect((await handleCollabState(ctx('GET', device, undefined, '', off), deps)).status).toBe(
      200,
    );
    expect(
      (
        await handleCollabInviteCancel(
          ctx('DELETE', owner, undefined, '', off, { key: invitation.key }),
          deps,
        )
      ).status,
    ).toBe(204);
    expect((await accept('x'.repeat(43))).status).toBe(401);
    expect(
      (
        await handleCollabRemoveMember(
          ctx('DELETE', device, undefined, '', off, { device: 'me' }),
          deps,
        )
      ).status,
    ).toBe(204);
    expect((await state()).status).toBe(401);
    expect(
      (
        await handleCollabRemoveMember(
          ctx('DELETE', owner, undefined, '', off, { device: joined.deviceId }),
          deps,
        )
      ).status,
    ).toBe(204);
  });
});

it('소유자는 v1을 읽어 병합한 v2를 공동본 경로로 올린 뒤 초대한다', async () => {
  await setup(1);
  expect(await (await state(owner)).json()).toMatchObject({ rev: 1, doc: { v: 1 } });
  expect((await createInvite()).status).toBe(409);
  expect(
    (await handleCollabPutDoc(ctx('PUT', owner, { doc: doc(), baseRev: 1 }), deps)).status,
  ).toBe(200);
  expect(await (await state(owner)).json()).toMatchObject({ rev: 2, doc: { v: 2 } });
  expect((await createInvite()).status).toBe(201);
});
