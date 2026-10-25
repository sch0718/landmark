// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { docFromMeeting, type MeetingDoc, type OnlineState } from 'src/domain/meeting/online-doc';
import { safeParse } from 'src/schema/parse';
import { OnlineStateSchema } from 'src/domain/meeting/online-doc';
import { ensureSchema } from 'src/server/meet/db';
import type { MeetContext, MeetEnv } from 'src/server/meet/env';
import {
  expiresAt,
  handleCreate,
  handleDelete,
  handleGet,
  handleUpdate,
  pruneExpired,
  readMeetingId,
  redactForGuest,
  type MeetDeps,
} from 'src/server/meet/handlers';
import { hashIp, hashToken } from 'src/server/meet/tokens';
import { verifyTurnstile } from 'src/server/meet/turnstile';
import { createSqliteD1 } from '../../helpers/sqlite-d1';
import { buildMeeting } from '../../fixtures/builders';

const NOW = new Date('2026-10-26T12:00:00.000Z');
const LOCAL = 'http://localhost:8788';
const PROD = 'https://landmark.sch0718.dev';
const home = { name: '집', lng: 127, lat: 37.5 };
const work = { name: '회사', lng: 127.1, lat: 37.6 };
const changed = { name: '바꾼 출발지', lng: 127.2, lat: 37.7 };
const doc = (patch: Partial<MeetingDoc> = {}): MeetingDoc => ({
  ...docFromMeeting(buildMeeting(), { choice01: { person01: 10, person02: 20 } }, 'min'),
  participants: [
    { id: 'person01', name: '나', origin: home },
    { id: 'person02', name: '친구', origin: work },
  ],
  times: { choice01: { person01: 10, person02: 20 } },
  ...patch,
});
let db: ReturnType<typeof createSqliteD1>;
let deps: MeetDeps;
let pending: Promise<unknown>[];
let env: MeetEnv;

beforeEach(() => {
  db = createSqliteD1();
  deps = { fetch: vi.fn<typeof fetch>(), now: () => NOW };
  pending = [];
  env = { DB: db, MEET_ONLINE: 'on' };
});
afterEach(async () => {
  await Promise.all(pending);
  db.close();
});

function context(
  method: string,
  body?: unknown,
  options: {
    origin?: string | null;
    token?: string;
    id?: string;
    query?: string;
    raw?: string;
  } = {},
): MeetContext {
  const headers = new Headers();
  if (options.origin !== null) headers.set('Origin', options.origin ?? LOCAL);
  headers.set('CF-Connecting-IP', '192.0.2.10');
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
  return {
    request: new Request(
      `${LOCAL}/api/meet${method === 'POST' ? '' : '/meeting001'}${options.query ?? ''}`,
      {
        method,
        headers,
        ...(body === undefined && options.raw === undefined
          ? {}
          : { body: options.raw ?? JSON.stringify(body) }),
      },
    ),
    env,
    params: { id: options.id ?? 'meeting001' },
    waitUntil: (promise) => {
      pending.push(promise);
    },
  };
}
async function create(current = doc()) {
  return handleCreate(context('POST', { doc: current, turnstile: 'dev' }), deps);
}
async function seed() {
  const response = await create();
  expect(response.status).toBe(201);
  const body = (await response.json()) as { id: string; rev: number; hostToken: string };
  await Promise.all(pending);
  return body.hostToken;
}
async function addReply(
  pid = 'person02',
  origin: typeof home | null = changed,
  meetingId = 'meeting001',
) {
  await db
    .prepare('INSERT INTO meeting_replies VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      meetingId,
      pid,
      '친구',
      origin === null ? null : JSON.stringify(origin),
      '["choice01"]',
      '{"choice01":25}',
      NOW.toISOString(),
    )
    .run();
  const token = `guest-${pid}-${meetingId}`;
  await db
    .prepare('INSERT INTO meeting_tokens VALUES (?, ?, ?, ?, ?)')
    .bind(await hashToken(token), meetingId, 'guest', pid, NOW.toISOString())
    .run();
  return token;
}
async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.json()).toMatchObject({ error: { code } });
}
async function count(table: 'meetings' | 'meeting_tokens' | 'meeting_replies') {
  return (await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>())!
    .count;
}

describe('약속 올리기', () => {
  it('본문과 주최자 해시를 원자적으로 저장하고 201로 토큰을 돌려준다', async () => {
    const response = await create();
    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({ id: 'meeting001', rev: 1, docRev: 1 });
    expect(body.hostToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await db.prepare('SELECT * FROM meeting_tokens').first()).toEqual({
      hash: await hashToken(body.hostToken),
      meeting_id: 'meeting001',
      kind: 'host',
      participant_id: null,
      created_at: NOW.toISOString(),
    });
    const stored = await db.prepare('SELECT * FROM meetings').first();
    expect(stored).toMatchObject({
      id: 'meeting001',
      doc: JSON.stringify(doc()),
      rev: 1,
      doc_rev: 1,
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      expires_at: '2026-11-25T12:00:00.000Z',
    });
    expect(JSON.stringify(stored)).not.toContain(body.hostToken);
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(pending.length).toBeGreaterThan(0);
    const counters = await db.prepare('SELECT key FROM rate_counters').all<{ key: string }>();
    expect(counters.results[0]?.key).toBe(
      `create:${await hashIp('192.0.2.10', 'dev-salt')}:2026-10-26`,
    );
  });
  it('토큰 저장 실패 시 본문도 남기지 않는다', async () => {
    await ensureSchema(db);
    await db
      .prepare(
        "CREATE TRIGGER reject_token BEFORE INSERT ON meeting_tokens BEGIN SELECT RAISE(ABORT, '시험 오류'); END",
      )
      .run();
    await expectError(await create(), 502, 'UPSTREAM_ERROR');
    expect(await count('meetings')).toBe(0);
  });
  it('같은 id를 다시 올리면 기존 본문과 토큰을 보존하고 409다', async () => {
    await seed();
    await expectError(await create(doc({ title: '덮어쓰기' })), 409, 'CONFLICT');
    expect(await count('meeting_tokens')).toBe(1);
    expect((await db.prepare('SELECT doc FROM meetings').first<{ doc: string }>())!.doc).toBe(
      JSON.stringify(doc()),
    );
  });
  it('동시에 같은 id를 올려도 하나만 만들고 나머지는 409다', async () => {
    const responses = await Promise.all([create(), create()]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await count('meeting_tokens')).toBe(1);
  });
  it.each([
    ['빈 제목', () => ({ doc: doc({ title: '' }), turnstile: 'dev' })],
    ['잘못된 참조', () => ({ doc: doc({ decided: 'missing1' }), turnstile: 'dev' })],
    ['64KB 초과', () => ({ doc: doc({ title: '가'.repeat(22_000) }), turnstile: 'dev' })],
    ['남는 문서 키', () => ({ doc: { ...doc(), sentAt: NOW.toISOString() }, turnstile: 'dev' })],
    ['남는 본문 키', () => ({ doc: doc(), turnstile: 'dev', extra: true })],
    ['검증 토큰 누락', () => ({ doc: doc() })],
    ['빈 본문', () => null],
  ])('%s는 400이다', async (_label, body) => {
    await expectError(await handleCreate(context('POST', body()), deps), 400, 'BAD_REQUEST');
  });
  it('깨진 JSON은 400이다', async () => {
    await expectError(
      await handleCreate(context('POST', undefined, { raw: '{' }), deps),
      400,
      'BAD_REQUEST',
    );
  });
  it('출처 검사는 스위치와 DB보다 먼저 한다', async () => {
    env.MEET_ONLINE = 'off';
    const batch = vi.spyOn(db, 'batch');
    await expectError(
      await handleCreate(context('POST', {}, { origin: 'https://evil.example' }), deps),
      403,
      'FORBIDDEN_ORIGIN',
    );
    expect(batch).not.toHaveBeenCalled();
  });
  it('기능을 끄면 DB와 검증을 부르지 않고 reason off를 돌려준다', async () => {
    env.MEET_ONLINE = 'off';
    const batch = vi.spyOn(db, 'batch');
    const response = await create();
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ reason: 'off', error: { code: 'UNAVAILABLE' } });
    expect(batch).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  it.each([
    ['운영의 소금 없음', PROD, { TURNSTILE_SECRET: '시험용-비밀키' }],
    ['운영의 검증 키 없음', PROD, { IP_HASH_SALT: '시험용-소금' }],
    ['미리보기의 설정 없음', 'https://preview.landmark-c5f.pages.dev', {}],
  ])('%s은 503 config다', async (_label, origin, config) => {
    Object.assign(env, config);
    const response = await handleCreate(
      context('POST', { doc: doc(), turnstile: 'test' }, { origin }),
      deps,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      reason: 'config',
      error: { code: 'UNAVAILABLE' },
    });
  });
  it('운영에서는 검증 성공 뒤 올린다', async () => {
    Object.assign(env, { IP_HASH_SALT: '시험용-소금', TURNSTILE_SECRET: '시험용-비밀키' });
    vi.mocked(deps.fetch).mockResolvedValue(new Response('{"success":true}'));
    const response = await handleCreate(
      context('POST', { doc: doc(), turnstile: 'test' }, { origin: PROD }),
      deps,
    );
    expect(response.status).toBe(201);
    expect(deps.fetch).toHaveBeenCalledOnce();
  });
  it('Turnstile 실패는 BAD_REQUEST이고 본문을 저장하지 않는다', async () => {
    env.TURNSTILE_SECRET = '시험용-비밀키';
    vi.mocked(deps.fetch).mockResolvedValue(new Response('{"success":false}'));
    const response = await create();
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'BAD_REQUEST' },
      reason: 'turnstile',
    });
    expect(await count('meetings')).toBe(0);
  });
  it('21번째 올리기는 검증 전 429이고 다음 UTC 날짜에는 다시 허용한다', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await create(doc({ meetingId: String(i).padStart(10, '0') }))).status).toBe(201);
      await Promise.all(pending);
    }
    env.TURNSTILE_SECRET = '시험용-비밀키';
    await expectError(await create(), 429, 'RATE_LIMITED');
    expect(deps.fetch).not.toHaveBeenCalled();
    delete env.TURNSTILE_SECRET;
    deps.now = () => new Date('2026-10-27T00:00:00Z');
    expect((await create()).status).toBe(201);
  });
  it('IP 헤더가 없으면 local의 해시만 기록한다', async () => {
    const ctx = context('POST', { doc: doc(), turnstile: 'dev' });
    ctx.request.headers.delete('CF-Connecting-IP');
    expect((await handleCreate(ctx, deps)).status).toBe(201);
    expect(await db.prepare('SELECT key FROM rate_counters').first()).toEqual({
      key: `create:${await hashIp('local', 'dev-salt')}:2026-10-26`,
    });
  });
});

describe('약속 읽기와 좌표 가리기', () => {
  it('버전이 같으면 본문 없는 304다', async () => {
    await seed();
    const response = await handleGet(context('GET', undefined, { query: '?since=1' }), deps);
    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('다른 버전이면 문서·답장·소요시간을 돌려준다', async () => {
    await seed();
    await addReply();
    const response = await handleGet(context('GET', undefined, { query: '?since=0' }), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const state = await response.json();
    expect(state).toMatchObject({
      rev: 1,
      docRev: 1,
      replies: [
        {
          participantId: 'person02',
          likes: ['choice01'],
          times: { choice01: 25 },
          updatedAt: NOW.toISOString(),
        },
      ],
    });
    expect(safeParse(OnlineStateSchema, state, { onExcessProperty: 'error' }).success).toBe(true);
  });
  it('없는 약속은 404다', async () => {
    await expectError(await handleGet(context('GET'), deps), 404, 'NOT_FOUND');
  });
  it('만료 시각과 같으면 since가 같아도 410이다', async () => {
    await seed();
    await db.prepare('UPDATE meetings SET expires_at = ?').bind(NOW.toISOString()).run();
    await expectError(
      await handleGet(context('GET', undefined, { query: '?since=1' }), deps),
      410,
      'ENDED',
    );
  });
  it('주최자 토큰이면 본문과 답장 출발지를 모두 돌려준다', async () => {
    const token = await seed();
    await addReply();
    const response = await handleGet(context('GET', undefined, { token }), deps);
    expect(await response.json()).toEqual({
      rev: 1,
      docRev: 1,
      doc: doc(),
      replies: [
        {
          participantId: 'person02',
          name: '친구',
          origin: changed,
          likes: ['choice01'],
          times: { choice01: 25 },
          updatedAt: NOW.toISOString(),
        },
      ],
    });
  });
  it.each([undefined, 'invalid-token'])(
    '토큰 %s이면 모든 참석자 좌표를 가리고 바뀐 출발지 이름을 준다',
    async (token) => {
      await seed();
      await addReply();
      const response = await handleGet(context('GET', undefined, { token }), deps);
      const state = (await response.json()) as OnlineState;
      expect(state.doc.participants.map((p) => p.origin)).toEqual([null, null]);
      expect(state.replies[0]?.origin).toBeNull();
      expect(state.originNames).toEqual({ person01: '집', person02: '바꾼 출발지' });
      expect(state.doc.times).toEqual(doc().times);
    },
  );
  it('참석자 토큰이면 자기 본문·답장 출발지만 남긴다', async () => {
    await seed();
    const token = await addReply();
    const state = (await (
      await handleGet(context('GET', undefined, { token }), deps)
    ).json()) as OnlineState;
    expect(state.doc.participants.map((p) => p.origin)).toEqual([null, work]);
    expect(state.replies[0]?.origin).toEqual(changed);
    expect(state.originNames).toMatchObject({ person01: '집' });
  });
  it('다른 약속의 주최자 토큰으로 전체 좌표를 읽지 못한다', async () => {
    const token = await seed();
    await db.prepare('UPDATE meeting_tokens SET meeting_id = ?').bind('another001').run();
    const state = (await (
      await handleGet(context('GET', undefined, { token }), deps)
    ).json()) as OnlineState;
    expect(state.doc.participants.every((p) => p.origin === null)).toBe(true);
  });
  it('가리기는 원본을 바꾸지 않고 새 참석자의 출발지 이름도 보존한다', () => {
    const state: OnlineState = {
      rev: 1,
      docRev: 1,
      doc: doc(),
      replies: [
        {
          participantId: 'person03',
          name: '새 친구',
          origin: changed,
          likes: [],
          times: null,
          updatedAt: NOW.toISOString(),
        },
      ],
    };
    const before = structuredClone(state);
    const redacted = redactForGuest(state, null);
    expect(state).toEqual(before);
    expect(redacted.docRev).toBe(1);
    expect(redacted.replies[0]?.origin).toBeNull();
    expect(redacted.originNames).toMatchObject({ person03: '바꾼 출발지' });
  });
  it('답장 출발지가 null이면 본문 출발지 이름을 쓴다', async () => {
    await seed();
    await addReply('person02', null);
    const state = (await (await handleGet(context('GET'), deps)).json()) as OnlineState;
    expect(state.originNames?.person02).toBe('회사');
  });
  it.each(['', '?since=1'])('정상 읽기 %s는 한도 카운터를 쓰지 않는다', async (query) => {
    await seed();
    await db.prepare('DELETE FROM rate_counters').run();
    expect((await handleGet(context('GET', undefined, { query }), deps)).status).toBe(
      query ? 304 : 200,
    );
    expect(await db.prepare('SELECT * FROM rate_counters').all()).toEqual({ results: [] });
  });
  it.each(['', '?since=1'])('읽기 한도를 다 써도 정상 읽기 %s는 허용한다', async (query) => {
    await seed();
    await db
      .prepare('INSERT INTO rate_counters VALUES (?, 5000)')
      .bind(`read:${await hashIp('192.0.2.10', 'dev-salt')}:2026-10-26`)
      .run();
    expect((await handleGet(context('GET', undefined, { query }), deps)).status).toBe(
      query ? 304 : 200,
    );
    expect(
      await db.prepare("SELECT count FROM rate_counters WHERE key LIKE 'read:%'").first(),
    ).toEqual({ count: 5000 });
  });
  it('없는 약속의 읽기는 5,000번까지 404이고 5,001번째는 429다', async () => {
    for (let i = 0; i < 5000; i++) {
      expect((await handleGet(context('GET'), deps)).status).toBe(404);
    }
    await expectError(await handleGet(context('GET'), deps), 429, 'RATE_LIMITED');
    expect(await db.prepare('SELECT count FROM rate_counters').first()).toEqual({ count: 5001 });
  });
  it('만료된 약속의 읽기도 같은 읽기 한도를 쓴다', async () => {
    await seed();
    await db.prepare('UPDATE meetings SET expires_at = ?').bind(NOW.toISOString()).run();
    await db
      .prepare('INSERT INTO rate_counters VALUES (?, 4999)')
      .bind(`read:${await hashIp('192.0.2.10', 'dev-salt')}:2026-10-26`)
      .run();
    await expectError(await handleGet(context('GET'), deps), 410, 'ENDED');
    await expectError(await handleGet(context('GET'), deps), 429, 'RATE_LIMITED');
  });
  it('출처 헤더가 없으면 Referer의 출처를 검사한다', async () => {
    await seed();
    const ctx = context('GET', undefined, { origin: null });
    ctx.request.headers.set('Referer', `${LOCAL}/meet/meeting001`);
    expect((await handleGet(ctx, deps)).status).toBe(200);
  });
  it('기능 스위치가 꺼져도 기존 약속은 읽는다', async () => {
    await seed();
    env.MEET_ONLINE = 'off';
    expect((await handleGet(context('GET'), deps)).status).toBe(200);
  });
});

describe('약속 고치기와 지우기', () => {
  it.each([undefined, 'wrong-token', 'guest'])(
    '주최자가 아닌 토큰 %s의 고치기·지우기는 401이다',
    async (kind) => {
      await seed();
      const token = kind === 'guest' ? await addReply() : kind;
      await expectError(
        await handleUpdate(context('PUT', { doc: doc(), baseRev: 1 }, { token }), deps),
        401,
        'UNAUTHORIZED',
      );
      await expectError(
        await handleDelete(context('DELETE', undefined, { token }), deps),
        401,
        'UNAUTHORIZED',
      );
      expect(await count('meetings')).toBe(1);
    },
  );
  it('버전이 다르면 현재 버전을 담은 409이고 변경하지 않는다', async () => {
    const token = await seed();
    const response = await handleUpdate(
      context('PUT', { doc: doc(), baseRev: 2 }, { token }),
      deps,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ docRev: 1, error: { code: 'CONFLICT' } });
    expect(await db.prepare('SELECT rev FROM meetings').first()).toEqual({ rev: 1 });
  });
  it('본문과 확정·갱신 시각·만료를 갱신하고 버전을 올린다', async () => {
    const token = await seed();
    deps.now = () => new Date('2026-10-27T12:00:00Z');
    const next = doc({ title: '수정한 모임', decided: 'choice01' });
    const response = await handleUpdate(context('PUT', { doc: next, baseRev: 1 }, { token }), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ rev: 2, docRev: 2 });
    expect(
      await db
        .prepare('SELECT doc, rev, doc_rev, created_at, updated_at, expires_at FROM meetings')
        .first(),
    ).toEqual({
      doc: JSON.stringify(next),
      rev: 2,
      doc_rev: 2,
      created_at: NOW.toISOString(),
      updated_at: '2026-10-27T12:00:00.000Z',
      expires_at: '2026-11-26T12:00:00.000Z',
    });
  });
  it('친구 답장으로 rev만 올라가도 본문 버전으로 고치고 빠진 참석자를 지운다', async () => {
    const token = await seed();
    await addReply();
    await db.prepare('UPDATE meetings SET rev = rev + 1').run();
    const next = doc({ participants: [doc().participants[0]!], times: {} });
    const response = await handleUpdate(context('PUT', { doc: next, baseRev: 1 }, { token }), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rev: 3, docRev: 2 });
    expect(await db.prepare('SELECT rev, doc_rev FROM meetings').first()).toEqual({
      rev: 3,
      doc_rev: 2,
    });
    expect(await count('meeting_replies')).toBe(0);
    expect(await count('meeting_tokens')).toBe(1);
    const state = await (await handleGet(context('GET', undefined, { token }), deps)).json();
    expect(state).toMatchObject({ rev: 3, docRev: 2, doc: next });
  });
  it('rev와 같아도 본문 버전이 다르면 현재 docRev를 담은 409다', async () => {
    const token = await seed();
    await addReply();
    await db.prepare('UPDATE meetings SET rev = rev + 1').run();
    const next = doc({ participants: [doc().participants[0]!], times: {} });
    const response = await handleUpdate(context('PUT', { doc: next, baseRev: 2 }, { token }), deps);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ docRev: 1, error: { code: 'CONFLICT' } });
    expect(await count('meeting_replies')).toBe(1);
    expect(await count('meeting_tokens')).toBe(2);
  });
  it('본문을 읽은 뒤 친구 답장이 도착해도 고치고 실제 rev를 돌려준다', async () => {
    const token = await seed();
    const batch = db.batch.bind(db);
    vi.spyOn(db, 'batch').mockImplementationOnce(async (statements) => {
      await db.prepare('UPDATE meetings SET rev = rev + 1').run();
      return batch(statements);
    });
    const response = await handleUpdate(
      context('PUT', { doc: doc(), baseRev: 1 }, { token }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rev: 3, docRev: 2 });
  });
  it('빠진 참석자의 답장·guest 토큰만 같은 배치에서 지운다', async () => {
    const token = await seed();
    await addReply();
    await addReply('person03');
    const next = doc({
      participants: [doc().participants[0]!],
      times: { choice01: { person01: 10 } },
    });
    expect(
      (await handleUpdate(context('PUT', { doc: next, baseRev: 1 }, { token }), deps)).status,
    ).toBe(200);
    expect(await db.prepare('SELECT participant_id FROM meeting_replies').all()).toEqual({
      results: [{ participant_id: 'person03' }],
    });
    expect(
      await db.prepare("SELECT participant_id FROM meeting_tokens WHERE kind = 'guest'").all(),
    ).toEqual({ results: [{ participant_id: 'person03' }] });
    expect(await count('meeting_tokens')).toBe(2);
  });
  it('갱신 실패 시 참석자 답장과 토큰도 남긴다', async () => {
    const token = await seed();
    await addReply();
    await db
      .prepare(
        "CREATE TRIGGER reject_update BEFORE UPDATE ON meetings BEGIN SELECT RAISE(ABORT, '시험 오류'); END",
      )
      .run();
    const next = doc({ participants: [doc().participants[0]!], times: {} });
    await expectError(
      await handleUpdate(context('PUT', { doc: next, baseRev: 1 }, { token }), deps),
      502,
      'UPSTREAM_ERROR',
    );
    expect(await count('meeting_replies')).toBe(1);
    expect(await count('meeting_tokens')).toBe(2);
  });
  it('동시 고치기는 하나만 성공하고 나머지는 409다', async () => {
    const token = await seed();
    const responses = await Promise.all([
      handleUpdate(context('PUT', { doc: doc({ title: '첫 수정' }), baseRev: 1 }, { token }), deps),
      handleUpdate(
        context('PUT', { doc: doc({ title: '둘째 수정' }), baseRev: 1 }, { token }),
        deps,
      ),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await responses.find((r) => r.status === 409)!.json()).toMatchObject({ docRev: 2 });
    expect(await db.prepare('SELECT rev FROM meetings').first()).toEqual({ rev: 2 });
  });
  it.each([
    ['다른 약속 id', () => ({ doc: doc({ meetingId: 'another001' }), baseRev: 1 })],
    ['스키마 오류', () => ({ doc: doc({ title: '' }), baseRev: 1 })],
    ['남는 키', () => ({ doc: doc(), baseRev: 1, extra: true })],
    ['소수 버전', () => ({ doc: doc(), baseRev: 1.5 })],
    ['문자열 버전', () => ({ doc: doc(), baseRev: '1' })],
    ['0 버전', () => ({ doc: doc(), baseRev: 0 })],
  ])('%s는 고치기 400이다', async (_label, body) => {
    const token = await seed();
    await expectError(
      await handleUpdate(context('PUT', body(), { token }), deps),
      400,
      'BAD_REQUEST',
    );
  });
  it('본문 바꾸기 일 한도를 넘으면 429다', async () => {
    const token = await seed();
    await db
      .prepare('INSERT INTO rate_counters VALUES (?, 300)')
      .bind(`update:${await hashIp('192.0.2.10', 'dev-salt')}:2026-10-26`)
      .run();
    await expectError(
      await handleUpdate(context('PUT', { doc: doc(), baseRev: 1 }, { token }), deps),
      429,
      'RATE_LIMITED',
    );
  });
  it('지우기는 약속·답장·토큰을 모두 지우고 이후 읽기는 404다', async () => {
    const token = await seed();
    await addReply();
    const response = await handleDelete(context('DELETE', undefined, { token }), deps);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await count('meetings')).toBe(0);
    expect(await count('meeting_replies')).toBe(0);
    expect(await count('meeting_tokens')).toBe(0);
    await expectError(await handleGet(context('GET'), deps), 404, 'NOT_FOUND');
  });
  it.each([handleUpdate, handleDelete])('만료된 약속을 바꾸거나 지울 수 없다', async (handler) => {
    const token = await seed();
    await db.prepare('UPDATE meetings SET expires_at = ?').bind(NOW.toISOString()).run();
    await expectError(
      await handler(context('PUT', { doc: doc(), baseRev: 1 }, { token }), deps),
      410,
      'ENDED',
    );
  });
});

describe('공통 입력 검사', () => {
  it.each([handleGet, handleUpdate, handleDelete])(
    '허용하지 않은 출처와 출처 누락은 403이다',
    async (handler) => {
      for (const origin of ['https://evil.example', null]) {
        await expectError(
          await handler(context('GET', undefined, { origin }), deps),
          403,
          'FORBIDDEN_ORIGIN',
        );
      }
    },
  );
  it.each([handleGet, handleUpdate, handleDelete])(
    '경로 id가 잘못됐으면 DB 조회 전 400이다',
    async (handler) => {
      const batch = vi.spyOn(db, 'batch');
      await expectError(
        await handler(context('GET', undefined, { id: 'bad' }), deps),
        400,
        'BAD_REQUEST',
      );
      expect(batch).not.toHaveBeenCalled();
    },
  );
  it('readMeetingId는 10자 id만 허용하고 배열·누락을 거부한다', () => {
    expect(readMeetingId(context('GET'))).toBe('meeting001');
    const cases: MeetContext['params'][] = [{}, { id: ['meeting001'] }, { id: 'MEETING001' }];
    for (const params of cases) {
      expect(() => readMeetingId({ ...context('GET'), params })).toThrow();
    }
  });
});

describe('만료 계산과 정리', () => {
  it.each([
    [null, '2026-11-25T12:00:00.000Z'],
    [{ date: '2026-10-01', time: '18:00' }, '2026-11-25T12:00:00.000Z'],
    [{ date: '2026-12-31', time: '23:30' }, '2027-01-30T14:30:00.000Z'],
    [{ date: '2026-10-26', time: '21:00' }, '2026-11-25T12:00:00.000Z'],
  ])('일시 %j와 갱신 중 늦은 시각부터 30일이다', (at, expected) => {
    expect(expiresAt(doc({ at }), NOW)).toBe(expected);
  });
  async function seedExpired() {
    await ensureSchema(db);
    for (let i = 0; i < 25; i++) {
      const id = String(i).padStart(10, '0');
      await db
        .prepare('INSERT INTO meetings VALUES (?, ?, 1, 1, ?, ?, ?)')
        .bind(
          id,
          JSON.stringify(doc({ meetingId: id })),
          NOW.toISOString(),
          NOW.toISOString(),
          i < 23 ? NOW.toISOString() : '2026-11-01T00:00:00Z',
        )
        .run();
      await addReply('person02', null, id);
    }
  }
  it('한 번에 최대 20개를 답장·토큰과 함께 지우고 살아 있는 약속을 남긴다', async () => {
    await seedExpired();
    expect(await pruneExpired(db, NOW, 20)).toBe(20);
    for (const table of ['meetings', 'meeting_tokens', 'meeting_replies'] as const)
      expect(await count(table)).toBe(5);
    expect(await pruneExpired(db, NOW, 20)).toBe(3);
    for (const table of ['meetings', 'meeting_tokens', 'meeting_replies'] as const)
      expect(await count(table)).toBe(2);
  });
  it('지울 수가 0이면 아무것도 지우지 않는다', async () => {
    await seedExpired();
    expect(await pruneExpired(db, NOW, 0)).toBe(0);
    expect(await count('meetings')).toBe(25);
  });
  it('올리기 뒤 waitUntil에서 만료 약속과 지난 날짜 카운터를 정리한다', async () => {
    await seedExpired();
    await db
      .prepare('INSERT INTO rate_counters VALUES (?, 1)')
      .bind('read:지난날:2026-10-25')
      .run();
    expect((await create()).status).toBe(201);
    await Promise.all(pending);
    expect(await count('meetings')).toBe(6);
    expect(
      await db
        .prepare('SELECT key FROM rate_counters WHERE key = ?')
        .bind('read:지난날:2026-10-25')
        .first(),
    ).toBeNull();
  });
});

describe('Turnstile 검증', () => {
  it('siteverify에 폼 본문을 보내고 success true만 허용한다', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"success":true}'));
    expect(await verifyTurnstile('시험-토큰', '시험-키', '192.0.2.10', fetchFn)).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(new URLSearchParams(String(init?.body))).toEqual(
      new URLSearchParams({ secret: '시험-키', response: '시험-토큰', remoteip: '192.0.2.10' }),
    );
  });
  it('IP가 없으면 remoteip를 보내지 않는다', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"success":true}'));
    expect(await verifyTurnstile('token', 'key', null, fetchFn)).toBe(true);
    expect(new URLSearchParams(String(fetchFn.mock.calls[0]?.[1]?.body)).has('remoteip')).toBe(
      false,
    );
  });
  it.each(['{"success":false}', '{"success":"true"}', '{}', '깨진 JSON', 'null'])(
    '응답 %s는 실패다',
    async (body) => {
      expect(
        await verifyTurnstile(
          'token',
          'key',
          null,
          vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
        ),
      ).toBe(false);
    },
  );
  it('네트워크 오류는 false다', async () => {
    expect(
      await verifyTurnstile(
        'token',
        'key',
        null,
        vi.fn<typeof fetch>().mockRejectedValue(new Error('연결 실패')),
      ),
    ).toBe(false);
  });
});
