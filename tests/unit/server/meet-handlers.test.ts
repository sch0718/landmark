// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { docFromMeeting, type MeetingDoc, type OnlineState } from 'src/domain/meeting/online-doc';
import { mergeOnline, overriddenReplyOrigins } from 'src/domain/meeting/online-merge';
import { emptyLibrary } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { OnlineStateSchema } from 'src/domain/meeting/online-doc';
import { ensureSchema } from 'src/server/meet/db';
import type { MeetContext, MeetEnv } from 'src/server/meet/env';
import {
  expiresAt,
  handleClaim,
  handleReply,
  handleRelease,
  handleCreate,
  handleDelete,
  handleGet,
  handleUpdate,
  pruneExpired,
  readMeetingId,
  redactForGuest,
  type MeetDeps,
} from 'src/server/meet/handlers';
import { hashIp, hashToken, newToken } from 'src/server/meet/tokens';
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
    urlOrigin?: string;
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
      `${options.urlOrigin ?? options.origin ?? LOCAL}/api/meet${method === 'POST' ? '' : '/meeting001'}${options.query ?? ''}`,
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
function claimContext(method: string, body?: unknown, options?: Parameters<typeof context>[2]) {
  return context(method, { guestToken: newToken(), ...(body as Record<string, unknown>) }, options);
}
async function create(current = doc(), hostToken = newToken()) {
  return handleCreate(context('POST', { doc: current, turnstile: 'dev', hostToken }), deps);
}
async function seed() {
  const response = await create();
  expect(response.status).toBe(201);
  const body = (await response.json()) as { id: string; rev: number; hostToken: string };
  await Promise.all(pending);
  return body.hostToken;
}

it('친구 B를 받은 주최자의 자동 저장 전에 친구가 C를 고르면 본문 B를 올려도 답장 C를 보존한다', async () => {
  const token = await seed();
  const guestToken = await addReply('person02', home);
  const received = (await (
    await handleGet(context('GET', undefined, { token }), deps)
  ).json()) as OnlineState;
  const originB = received.replies[0]!.origin!;
  expect(
    (
      await handleReply(
        context(
          'PUT',
          { origin: changed, likes: ['choice01'], times: { choice01: 30 }, docRev: 1 },
          { token: guestToken },
        ),
        deps,
      )
    ).status,
  ).toBe(200);
  const next = doc({
    participants: doc().participants.map((p) =>
      p.id === 'person02' ? { ...p, origin: originB } : p,
    ),
  });
  expect(
    (await handleUpdate(context('PUT', { doc: next, baseRev: 1 }, { token }), deps)).status,
  ).toBe(200);
  expect(await db.prepare('SELECT origin, times FROM meeting_replies').first()).toEqual({
    origin: JSON.stringify(changed),
    times: '{"choice01":30}',
  });
});

it.each(['요청 전', '배치 직전'] as const)(
  '명시적 덮어쓰기 대상 B와 다른 친구 D가 %s 도착하면 D를 보존한다',
  async (timing) => {
    const token = await seed();
    const guestToken = await addReply('person02', work);
    const reply = async () => {
      expect(
        (
          await handleReply(
            context(
              'PUT',
              { origin: changed, likes: ['choice01'], times: { choice01: 30 }, docRev: 1 },
              { token: guestToken },
            ),
            deps,
          )
        ).status,
      ).toBe(200);
    };
    if (timing === '요청 전') await reply();
    else {
      const batch = db.batch.bind(db);
      vi.spyOn(db, 'batch').mockImplementationOnce(async (statements) => {
        await reply();
        return batch(statements);
      });
    }
    const next = doc({
      participants: doc().participants.map((p) =>
        p.id === 'person02' ? { ...p, origin: home } : p,
      ),
    });
    expect(
      (
        await handleUpdate(
          context(
            'PUT',
            {
              doc: next,
              baseRev: 1,
              clearReplyOrigins: [{ participantId: 'person02', origin: work }],
            },
            { token },
          ),
          deps,
        )
      ).status,
    ).toBe(200);
    expect(await db.prepare('SELECT origin, times FROM meeting_replies').first()).toEqual({
      origin: JSON.stringify(changed),
      times: '{"choice01":30}',
    });
  },
);

it('기기 A가 답장 B를 C로 명시적으로 덮어쓰면 기기 B도 본문 C를 유지한다', async () => {
  const token = await seed();
  await addReply('person02', work);
  const originalDoc = doc();
  const local = buildMeeting({
    participants: { value: originalDoc.participants, updatedAt: NOW.toISOString() },
  });
  const sync = {
    syncedDoc: originalDoc,
    docRev: 1,
    seen: [],
    hostLikes: null,
    hostLikesAckRev: null,
    replyOrigins: { person02: work },
  };
  const next = doc({
    participants: originalDoc.participants.map((p) =>
      p.id === 'person02' ? { ...p, origin: changed } : p,
    ),
  });
  const clearReplyOrigins = overriddenReplyOrigins(next.participants, sync.replyOrigins);
  expect(clearReplyOrigins).toEqual([{ participantId: 'person02', origin: work }]);
  expect(
    (
      await handleUpdate(
        context('PUT', { doc: next, baseRev: 1, clearReplyOrigins }, { token }),
        deps,
      )
    ).status,
  ).toBe(200);
  const remote = (await (
    await handleGet(context('GET', undefined, { token }), deps)
  ).json()) as OnlineState;
  expect(remote.replies[0]).toMatchObject({ origin: null, times: null });
  const merged = mergeOnline(
    { ...emptyLibrary(), meetings: { [local.id]: local } },
    local.id,
    remote,
    { now: NOW.toISOString(), newId: newToken },
    sync,
  );
  expect(merged.ok).toBe(true);
  if (merged.ok)
    expect(merged.lib.meetings![local.id]!.participants.value[1]?.origin).toEqual(changed);
});

it('본문이 같아도 지정한 답장 출발지와 시간만 비우고 주최자 id는 무시한다', async () => {
  const token = await seed();
  await addReply();
  await addReply('person01');
  await addReply('person03');
  const response = await handleUpdate(
    context(
      'PUT',
      {
        doc: doc(),
        baseRev: 1,
        clearReplyOrigins: [
          { participantId: 'person01', origin: changed },
          { participantId: 'person02', origin: changed },
        ],
      },
      { token },
    ),
    deps,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ rev: 2, docRev: 2 });
  const { results } = await db
    .prepare(
      'SELECT participant_id, origin, times, likes, updated_at FROM meeting_replies ORDER BY participant_id',
    )
    .all();
  expect(results).toEqual(
    ['person01', 'person02', 'person03'].map((pid) => ({
      participant_id: pid,
      origin: pid === 'person02' ? null : JSON.stringify(changed),
      times: pid === 'person02' ? null : '{"choice01":25}',
      likes: '["choice01"]',
      updated_at: NOW.toISOString(),
    })),
  );
});

it('출발지 비우기도 같은 batch의 버전 조건 안에서만 적용한다', async () => {
  const token = await seed();
  await addReply();
  const batch = db.batch.bind(db);
  vi.spyOn(db, 'batch').mockImplementationOnce(async (statements) => {
    await db.prepare('UPDATE meetings SET doc_rev = doc_rev + 1').run();
    return batch(statements);
  });
  expect(
    (
      await handleUpdate(
        context(
          'PUT',
          {
            doc: doc(),
            baseRev: 1,
            clearReplyOrigins: [{ participantId: 'person02', origin: changed }],
          },
          { token },
        ),
        deps,
      )
    ).status,
  ).toBe(409);
  expect(await db.prepare('SELECT origin, times FROM meeting_replies').first()).toEqual({
    origin: JSON.stringify(changed),
    times: '{"choice01":25}',
  });
});

it.each([
  { clearReplyOrigins: ['person02'] },
  { clearReplyOrigins: [{ participantId: 'wrong', origin: changed }] },
  { clearReplyOrigins: [{ participantId: 'person02' }] },
  { clearReplyOrigins: [{ participantId: 'person02', origin: null }] },
  { clearReplyOrigins: [{ participantId: 'person02', origin: { ...changed, lat: 90 } }] },
  {
    clearReplyOrigins: Array.from({ length: 11 }, (_, i) => ({
      participantId: `person${String(i).padStart(2, '0')}`,
      origin: changed,
    })),
  },
])(
  '답장 출발지를 비울 id·출발지 형식과 최대 10명 제한을 검사한다: %j',
  async ({ clearReplyOrigins }) => {
    const token = await seed();
    expect(
      (
        await handleUpdate(
          context('PUT', { doc: doc(), baseRev: 1, clearReplyOrigins }, { token }),
          deps,
        )
      ).status,
    ).toBe(400);
  },
);

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
  it('같은 주최자 토큰으로 다시 올리면 본문을 보존하고 현재 버전으로 성공한다', async () => {
    const hostToken = newToken();
    const first = await create(doc(), hostToken);
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({
      id: doc().meetingId,
      rev: 1,
      docRev: 1,
      hostToken,
      created: true,
    });
    await handleUpdate(
      context('PUT', { doc: doc({ title: '새 제목' }), baseRev: 1 }, { token: hostToken }),
      deps,
    );
    const retry = await create(doc(), hostToken);
    expect(retry.status).toBe(200);
    expect(retry.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await retry.json()).toEqual({
      id: doc().meetingId,
      rev: 2,
      docRev: 2,
      hostToken,
      created: false,
    });
    expect(await count('meetings')).toBe(1);
    expect(await count('meeting_tokens')).toBe(1);
    expect(
      JSON.parse((await db.prepare('SELECT doc FROM meetings').first<{ doc: string }>())!.doc)
        .title,
    ).toBe('새 제목');
  });
  it('처음 올리기는 created true이고 바뀐 본문의 같은 토큰 재시도는 created false로 원본을 남긴다', async () => {
    const hostToken = newToken();
    const first = await create(doc(), hostToken);
    expect(await first.json()).toMatchObject({ created: true });
    const retry = await create(doc({ title: '응답 유실 뒤 고친 제목' }), hostToken);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({
      id: doc().meetingId,
      rev: 1,
      docRev: 1,
      hostToken,
      created: false,
    });
    expect(
      JSON.parse((await db.prepare('SELECT doc FROM meetings').first<{ doc: string }>())!.doc)
        .title,
    ).toBe(doc().title);
  });
  it('같은 토큰의 동시 올리기도 둘 다 성공하고 한 약속만 만든다', async () => {
    const hostToken = newToken();
    const responses = await Promise.all([create(doc(), hostToken), create(doc(), hostToken)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await count('meetings')).toBe(1);
    expect(await count('meeting_tokens')).toBe(1);
  });
  it.each([
    undefined,
    null,
    '',
    'a'.repeat(42),
    'a'.repeat(44),
    '+'.repeat(43),
    'a'.repeat(43) + '\n',
  ])('주최자 토큰 %j는 올릴 수 없다', async (hostToken) => {
    await expectError(
      await handleCreate(context('POST', { doc: doc(), turnstile: 'dev', hostToken }), deps),
      400,
      'BAD_REQUEST',
    );
  });
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
    [
      '참석자 없음',
      () => ({
        doc: doc({ participants: [], times: {} }),
        turnstile: 'dev',
        hostToken: newToken(),
      }),
    ],
    ['빈 제목', () => ({ doc: doc({ title: '' }), turnstile: 'dev', hostToken: newToken() })],
    [
      '잘못된 참조',
      () => ({ doc: doc({ decided: 'missing1' }), turnstile: 'dev', hostToken: newToken() }),
    ],
    [
      '64KB 초과',
      () => ({ doc: doc({ title: '가'.repeat(22_000) }), turnstile: 'dev', hostToken: newToken() }),
    ],
    [
      '남는 문서 키',
      () => ({
        doc: { ...doc(), sentAt: NOW.toISOString() },
        turnstile: 'dev',
        hostToken: newToken(),
      }),
    ],
    ['남는 본문 키', () => ({ doc: doc(), turnstile: 'dev', hostToken: newToken(), extra: true })],
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
      context('POST', { doc: doc(), turnstile: 'test', hostToken: newToken() }, { origin }),
      deps,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      reason: 'config',
      error: { code: 'UNAVAILABLE' },
    });
  });
  it.each([{}, { TURNSTILE_SECRET: '시험용-비밀키' }, { IP_HASH_SALT: '시험용-소금' }])(
    '운영 요청에 localhost Origin을 위조해도 누락 설정 %j를 우회하지 못한다',
    async (config) => {
      Object.assign(env, config);
      const response = await handleCreate(
        context(
          'POST',
          { doc: doc(), turnstile: 'test', hostToken: newToken() },
          {
            origin: LOCAL,
            urlOrigin: PROD,
          },
        ),
        deps,
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ reason: 'config' });
      expect(deps.fetch).not.toHaveBeenCalled();
    },
  );
  it.each(['localhost', '127.0.0.1', '[::1]'])(
    '요청 주소가 %s면 시크릿 없이 개발 예외를 허용한다',
    async (hostname) => {
      const response = await handleCreate(
        context(
          'POST',
          { doc: doc(), turnstile: 'dev', hostToken: newToken() },
          {
            origin: LOCAL,
            urlOrigin: `http://${hostname}:8788`,
          },
        ),
        deps,
      );
      expect(response.status).toBe(201);
      expect(deps.fetch).not.toHaveBeenCalled();
    },
  );
  it('운영에서는 검증 성공 뒤 올린다', async () => {
    Object.assign(env, { IP_HASH_SALT: '시험용-소금', TURNSTILE_SECRET: '시험용-비밀키' });
    vi.mocked(deps.fetch).mockResolvedValue(new Response('{"success":true}'));
    const response = await handleCreate(
      context('POST', { doc: doc(), turnstile: 'test', hostToken: newToken() }, { origin: PROD }),
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
    const ctx = context('POST', { doc: doc(), turnstile: 'dev', hostToken: newToken() });
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
  it('토큰 헤더가 없으면 모든 참석자 좌표를 가리고 바뀐 출발지 이름을 준다', async () => {
    await seed();
    await addReply();
    const response = await handleGet(context('GET'), deps);
    expect(response.status).toBe(200);
    const state = (await response.json()) as OnlineState;
    expect(state.doc.participants.map((p) => p.origin)).toEqual([null, null]);
    expect(state.replies[0]?.origin).toBeNull();
    expect(state.originNames).toEqual({ person01: '집', person02: '바꾼 출발지' });
    expect(state.doc.times).toEqual(doc().times);
  });
  it.each(['', '?since=1'])('틀린 Bearer는 버전과 무관하게 401이다(%s)', async (query) => {
    await seed();
    await expectError(
      await handleGet(context('GET', undefined, { token: 'invalid-token', query }), deps),
      401,
      'UNAUTHORIZED',
    );
  });
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
  it('다른 약속의 주최자 토큰으로 읽으면 401이다', async () => {
    const token = await seed();
    await db.prepare('UPDATE meeting_tokens SET meeting_id = ?').bind('another001').run();
    await expectError(
      await handleGet(context('GET', undefined, { token }), deps),
      401,
      'UNAUTHORIZED',
    );
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
  it('다른 기기의 제목만 바뀐 본문을 받아도 친구 출발지와 다음 제목 갱신의 답장 출발지를 보존한다', async () => {
    const token = await seed();
    const guestToken = await addReply('person02', work);
    const originalDoc = doc();
    const local = buildMeeting({
      participants: { value: originalDoc.participants, updatedAt: NOW.toISOString() },
    });
    const sync = {
      syncedDoc: originalDoc,
      docRev: 1,
      seen: [],
      hostLikes: null,
      hostLikesAckRev: null,
      replyOrigins: { person02: work },
    };
    const ctx = { now: NOW.toISOString(), newId: newToken };
    expect(
      (
        await handleReply(
          context(
            'PUT',
            { origin: changed, likes: ['choice01'], times: { choice01: 25 }, docRev: 1 },
            { token: guestToken },
          ),
          deps,
        )
      ).status,
    ).toBe(200);
    const firstResponse = await handleGet(context('GET', undefined, { token }), deps);
    expect(firstResponse.status).toBe(200);
    const firstState = (await firstResponse.json()) as OnlineState;
    const first = mergeOnline(
      { ...emptyLibrary(), meetings: { [local.id]: local } },
      local.id,
      firstState,
      ctx,
      sync,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.lib.meetings![local.id]!.participants.value[1]?.origin).toEqual(changed);

    // 다른 기기는 친구의 새 출발지를 아직 본문에 반영하지 않았다.
    const remoteDoc = { ...originalDoc, title: '다른 기기 제목' };
    expect(
      (await handleUpdate(context('PUT', { doc: remoteDoc, baseRev: 1 }, { token }), deps)).status,
    ).toBe(200);
    const remoteResponse = await handleGet(context('GET', undefined, { token }), deps);
    expect(remoteResponse.status).toBe(200);
    const remoteState = (await remoteResponse.json()) as OnlineState;
    expect(remoteState.doc.participants[1]?.origin).toEqual(work);
    expect(remoteState.replies.find((r) => r.participantId === 'person02')?.origin).toEqual(
      changed,
    );
    const merged = mergeOnline(first.lib, local.id, remoteState, ctx, {
      ...sync,
      replyOrigins: first.replyOrigins,
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const next = merged.lib.meetings![local.id]!;
    expect(next.title.value).toBe(remoteDoc.title);
    expect(next.participants.value[1]?.origin).toEqual(changed);
    expect(merged.replyOrigins).toEqual({ person02: changed });
    const clearReplyOrigins = overriddenReplyOrigins(next.participants.value, merged.replyOrigins);
    expect(clearReplyOrigins).toEqual([]);
    // 본문 출발지가 그대로인 다음 갱신에 잘못된 답장 삭제가 실리지 않아야 한다.
    expect(
      (
        await handleUpdate(
          context(
            'PUT',
            {
              doc: { ...remoteState.doc, title: '다음 제목' },
              baseRev: remoteState.docRev,
              clearReplyOrigins,
            },
            { token },
          ),
          deps,
        )
      ).status,
    ).toBe(200);
    const finalResponse = await handleGet(context('GET', undefined, { token }), deps);
    expect(finalResponse.status).toBe(200);
    const finalState = (await finalResponse.json()) as OnlineState;
    expect(finalState.replies.find((r) => r.participantId === 'person02')?.origin).toEqual(changed);
  });

  it.each([home, null])(
    '출발지를 %j로 명시적으로 덮어쓴 참석자의 일치하는 답장 출발지와 시간만 비운다',
    async (origin) => {
      const token = await seed();
      const guestToken = await addReply();
      await addReply('person03');
      await addReply('person02', changed, 'another001');
      const next = doc({
        participants: doc().participants.map((p) => (p.id === 'person02' ? { ...p, origin } : p)),
      });
      const response = await handleUpdate(
        context(
          'PUT',
          {
            doc: next,
            baseRev: 1,
            clearReplyOrigins: [{ participantId: 'person02', origin: changed }],
          },
          { token },
        ),
        deps,
      );
      expect(response.status).toBe(200);
      expect(
        await db
          .prepare(
            'SELECT origin, times, likes, updated_at FROM meeting_replies WHERE meeting_id = ? AND participant_id = ?',
          )
          .bind('meeting001', 'person02')
          .first(),
      ).toEqual({
        origin: null,
        times: null,
        likes: '["choice01"]',
        updated_at: NOW.toISOString(),
      });
      for (const [meetingId, pid] of [
        ['meeting001', 'person03'],
        ['another001', 'person02'],
      ]) {
        expect(
          await db
            .prepare(
              'SELECT origin, times FROM meeting_replies WHERE meeting_id = ? AND participant_id = ?',
            )
            .bind(meetingId!, pid!)
            .first(),
        ).toEqual({ origin: JSON.stringify(changed), times: '{"choice01":25}' });
      }
      expect(
        (
          await handleReply(
            context(
              'PUT',
              { likes: ['choice01'], origin: changed, times: { choice01: 30 }, docRev: 2 },
              { token: guestToken },
            ),
            deps,
          )
        ).status,
      ).toBe(200);
      expect(
        await db
          .prepare(
            'SELECT origin, times FROM meeting_replies WHERE meeting_id = ? AND participant_id = ?',
          )
          .bind('meeting001', 'person02')
          .first(),
      ).toEqual({ origin: JSON.stringify(changed), times: '{"choice01":30}' });
    },
  );

  it('본문을 읽은 뒤 버전이 바뀌면 답장 출발지와 시간을 비우지 않는다', async () => {
    const token = await seed();
    await addReply();
    const batch = db.batch.bind(db);
    vi.spyOn(db, 'batch').mockImplementationOnce(async (statements) => {
      await db.prepare('UPDATE meetings SET doc_rev = doc_rev + 1').run();
      return batch(statements);
    });
    const next = doc({
      participants: doc().participants.map((p) =>
        p.id === 'person02' ? { ...p, origin: home } : p,
      ),
    });
    expect(
      (
        await handleUpdate(
          context(
            'PUT',
            {
              doc: next,
              baseRev: 1,
              clearReplyOrigins: [{ participantId: 'person02', origin: changed }],
            },
            { token },
          ),
          deps,
        )
      ).status,
    ).toBe(409);
    expect(await db.prepare('SELECT origin, times FROM meeting_replies').first()).toEqual({
      origin: JSON.stringify(changed),
      times: '{"choice01":25}',
    });
  });
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
  it.each([
    ['이동수단', { mode: 'straight', unit: 'm' }],
    ['약속 일시', { at: { date: '2026-10-31', time: '18:00' } }],
    ['후보 경도', { candidates: doc().candidates.map((c) => ({ ...c, lng: c.lng + 0.01 })) }],
    ['후보 위도', { candidates: doc().candidates.map((c) => ({ ...c, lat: c.lat + 0.01 })) }],
    [
      '후보 추가',
      { candidates: [...doc().candidates, { ...doc().candidates[0]!, id: 'choice02' }] },
    ],
    ['후보 삭제', { candidates: [], times: {} }],
    ['후보 id', { candidates: [{ ...doc().candidates[0]!, id: 'choice02' }], times: {} }],
  ] satisfies [string, Partial<MeetingDoc>][])(
    '%s 변경은 이 약속의 모든 답장 times만 비운다',
    async (_label, patch) => {
      const token = await seed();
      await addReply();
      await addReply('person03');
      await addReply('person02', changed, 'another001');
      const response = await handleUpdate(
        context('PUT', { doc: doc(patch), baseRev: 1 }, { token }),
        deps,
      );
      expect(response.status).toBe(200);
      expect(
        (
          await db
            .prepare('SELECT times, likes, origin FROM meeting_replies WHERE meeting_id = ?')
            .bind('meeting001')
            .all()
        ).results,
      ).toEqual([
        { times: null, likes: '["choice01"]', origin: JSON.stringify(changed) },
        { times: null, likes: '["choice01"]', origin: JSON.stringify(changed) },
      ]);
      expect(
        await db
          .prepare('SELECT times FROM meeting_replies WHERE meeting_id = ?')
          .bind('another001')
          .first(),
      ).toEqual({ times: '{"choice01":25}' });
    },
  );
  it.each([
    ['제목', { title: '새 제목' }],
    ['후보 이름', { candidates: doc().candidates.map((c) => ({ ...c, name: '새 이름' })) }],
  ] satisfies [string, Partial<MeetingDoc>][])(
    '%s만 바꾸면 답장 times를 보존한다',
    async (_label, patch) => {
      const token = await seed();
      await addReply();
      expect(
        (await handleUpdate(context('PUT', { doc: doc(patch), baseRev: 1 }, { token }), deps))
          .status,
      ).toBe(200);
      expect(await db.prepare('SELECT times FROM meeting_replies').first()).toEqual({
        times: '{"choice01":25}',
      });
    },
  );
  it('본문을 읽은 뒤 doc_rev가 바뀌면 소요시간도 비우지 않는다', async () => {
    const token = await seed();
    await addReply();
    const batch = db.batch.bind(db);
    vi.spyOn(db, 'batch').mockImplementationOnce(async (statements) => {
      await db.prepare('UPDATE meetings SET doc_rev = doc_rev + 1').run();
      return batch(statements);
    });
    expect(
      (
        await handleUpdate(
          context(
            'PUT',
            {
              doc: doc({ mode: 'straight', unit: 'm' }),
              baseRev: 1,
            },
            { token },
          ),
          deps,
        )
      ).status,
    ).toBe(409);
    expect(await db.prepare('SELECT times FROM meeting_replies').first()).toEqual({
      times: '{"choice01":25}',
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
  it.each(['본문', '답장'] as const)(
    '배치 직후 다른 기기의 %s 갱신이 끼어도 이 요청의 버전을 돌려준다',
    async (kind) => {
      const token = await seed();
      const guestToken = await addReply();
      const batch = db.batch.bind(db);
      vi.spyOn(db, 'batch').mockImplementationOnce(async (statements) => {
        const results = await batch(statements);
        const later =
          kind === '본문'
            ? await handleUpdate(
                context('PUT', { doc: doc({ title: '다른 기기의 수정' }), baseRev: 2 }, { token }),
                deps,
              )
            : await handleReply(context('PUT', { likes: [] }, { token: guestToken }), deps);
        expect(later.status).toBe(200);
        return results;
      });
      const response = await handleUpdate(
        context('PUT', { doc: doc({ title: '이 기기의 수정' }), baseRev: 1 }, { token }),
        deps,
      );
      expect(response.status).toBe(200);
      const written = await response.json();
      expect(written).toEqual({ rev: 2, docRev: 2 });
      expect(await db.prepare('SELECT rev, doc_rev FROM meetings').first()).toEqual({
        rev: 3,
        doc_rev: kind === '본문' ? 3 : 2,
      });
      const next = await handleGet(
        context('GET', undefined, { token, query: `?since=${written.rev}` }),
        deps,
      );
      expect(next.status).toBe(200);
      expect(await next.json()).toMatchObject({ rev: 3, docRev: kind === '본문' ? 3 : 2 });
    },
  );
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
    ['참석자 없음', () => ({ doc: doc({ participants: [], times: {} }), baseRev: 1 })],
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
  it('경로 id·본문 형식이 틀리면 약속 문구로 400이다', async () => {
    const invalid = { error: { code: 'BAD_REQUEST', message: '약속 입력이 올바르지 않아요' } };
    const badId = await handleGet(context('GET', undefined, { id: 'bad' }), deps);
    expect(await badId.json()).toEqual(invalid);
    const badBody = await handleCreate(context('POST', { doc: doc(), turnstile: 'dev' }), deps);
    expect(badBody.status).toBe(400);
    expect(await badBody.json()).toEqual(invalid);
  });
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

describe('참석자 고르기', () => {
  it.each([false, true])(
    '같은 참석자 토큰의 재시도는 rev와 토큰을 늘리지 않는다 (동시: %s)',
    async (concurrent) => {
      await seed();
      const guestToken = newToken();
      const request = () =>
        handleClaim(claimContext('POST', { participantId: 'person02', guestToken }), deps);
      const responses = concurrent
        ? await Promise.all([request(), request()])
        : [await request(), await request()];
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      const bodies = await Promise.all(responses.map((r) => r.json()));
      expect(bodies).toEqual([
        { participantId: 'person02', guestToken, rev: 2 },
        { participantId: 'person02', guestToken, rev: 2 },
      ]);
      expect(await count('meeting_tokens')).toBe(2);
      const other = await handleClaim(
        claimContext('POST', { participantId: 'person02', guestToken: newToken() }),
        deps,
      );
      await expectError(other, 409, 'CONFLICT');
      expect(await db.prepare('SELECT rev FROM meetings').first()).toEqual({ rev: 2 });
    },
  );
  it.each([false, true])(
    '새 이름도 같은 토큰으로 재시도하면 참석자 하나만 만든다 (동시: %s)',
    async (concurrent) => {
      await seed();
      const guestToken = newToken();
      const request = (newName: string) =>
        handleClaim(claimContext('POST', { newName, guestToken }), deps);
      const responses = concurrent
        ? await Promise.all([request('새 친구'), request('바뀐 이름')])
        : [await request('새 친구'), await request('바뀐 이름')];
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      const bodies = await Promise.all(responses.map((r) => r.json()));
      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[0]).toMatchObject({ guestToken, rev: 2 });
      expect(await count('meeting_replies')).toBe(1);
      expect(await count('meeting_tokens')).toBe(2);
      expect(await db.prepare('SELECT rev FROM meetings').first()).toEqual({ rev: 2 });
    },
  );

  it.each([undefined, '', 'short', '가'.repeat(43), 'g'.repeat(44)])(
    '고르기 토큰 %j는 400이고 토큰을 남기지 않는다',
    async (guestToken) => {
      await seed();
      await expectError(
        await handleClaim(context('POST', { participantId: 'person02', guestToken }), deps),
        400,
        'BAD_REQUEST',
      );
      expect(await count('meeting_tokens')).toBe(1);
    },
  );
  async function claim(body: unknown) {
    return handleClaim(claimContext('POST', body), deps);
  }
  async function conflict(body: unknown, reason: string) {
    const response = await claim(body);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason, error: { code: 'CONFLICT' } });
  }
  it('고른 참석자 토큰은 해시로 저장하고 rev만 올린다', async () => {
    await seed();
    const response = await claim({ participantId: 'person02' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({ participantId: 'person02', rev: 2 });
    expect(body.guestToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      await db
        .prepare("SELECT hash, participant_id FROM meeting_tokens WHERE kind = 'guest'")
        .first(),
    ).toEqual({ hash: await hashToken(body.guestToken), participant_id: 'person02' });
    expect(await db.prepare('SELECT rev, doc_rev, doc FROM meetings').first()).toEqual({
      rev: 2,
      doc_rev: 1,
      doc: JSON.stringify(doc()),
    });
  });
  it('이미 고른 참석자는 taken이고 주최자는 host이다', async () => {
    await seed();
    expect((await claim({ participantId: 'person02' })).status).toBe(200);
    await conflict({ participantId: 'person02' }, 'taken');
    await conflict({ participantId: 'person01' }, 'host');
    await conflict({ newName: ' 나 ' }, 'host');
  });
  it('없는 참석자 id는 404다', async () => {
    await seed();
    await expectError(await claim({ participantId: 'person99' }), 404, 'NOT_FOUND');
  });
  it('새 이름은 NFC와 공백을 정리해 빈 답장 줄로 만든다', async () => {
    await seed();
    const response = await claim({ newName: '  가   친구  ' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.participantId).toMatch(/^[a-z0-9]{8}$/);
    expect(await db.prepare('SELECT * FROM meeting_replies').first()).toEqual({
      meeting_id: 'meeting001',
      participant_id: body.participantId,
      name: '가 친구',
      origin: null,
      likes: '[]',
      times: null,
      updated_at: NOW.toISOString(),
    });
    expect(await db.prepare('SELECT doc FROM meetings').first()).toEqual({
      doc: JSON.stringify(doc()),
    });
  });
  it('같은 이름이면 본문 참석자를 고르고 차지 중이면 taken이다', async () => {
    const next = doc({
      participants: [doc().participants[0]!, { id: 'person02', name: '가  친구', origin: work }],
    });
    expect((await create(next)).status).toBe(201);
    const response = await claim({ newName: '  가 친구 ' });
    expect(await response.json()).toMatchObject({ participantId: 'person02' });
    expect(await count('meeting_replies')).toBe(0);
    await conflict({ newName: '가 친구' }, 'taken');
  });
  it('답장에만 있는 새 참석자 이름도 중복 차지를 막는다', async () => {
    await seed();
    expect((await claim({ newName: '새 친구' })).status).toBe(200);
    await conflict({ newName: ' 새   친구 ' }, 'taken');
    expect(await count('meeting_replies')).toBe(1);
  });
  it('본문에서 이름을 바꾼 참석자의 옛 답장 이름으로 차지하지 않는다', async () => {
    const host = await seed();
    await addReply();
    const next = doc({
      participants: [doc().participants[0]!, { id: 'person02', name: '바꾼 이름', origin: work }],
    });
    expect(
      (await handleUpdate(context('PUT', { doc: next, baseRev: 1 }, { token: host }), deps)).status,
    ).toBe(200);
    const response = await claim({ newName: '친구' });
    expect(response.status).toBe(200);
    expect((await response.json()).participantId).not.toBe('person02');
    expect(await count('meeting_replies')).toBe(2);
  });
  it('본문과 새 답장 참석자를 합쳐 10명까지만 만든다', async () => {
    await seed();
    for (let i = 0; i < 8; i++) expect((await claim({ newName: `새 친구 ${i}` })).status).toBe(200);
    await conflict({ newName: '열한 번째' }, 'full');
    expect((await claim({ newName: '친구' })).status).toBe(200);
    expect(await count('meeting_replies')).toBe(8);
  });
  it('본문으로 합쳐진 새 참석자를 중복으로 세지 않는다', async () => {
    const host = await seed();
    const response = await claim({ newName: '새 친구' });
    const { participantId } = await response.json();
    const next = doc({
      participants: [...doc().participants, { id: participantId, name: '새 친구', origin: null }],
    });
    expect(
      (await handleUpdate(context('PUT', { doc: next, baseRev: 1 }, { token: host }), deps)).status,
    ).toBe(200);
    for (let i = 0; i < 7; i++) expect((await claim({ newName: `친구 ${i}` })).status).toBe(200);
    await conflict({ newName: '초과' }, 'full');
  });
  it('동시에 같은 참석자를 고르면 한 요청만 성공한다', async () => {
    await seed();
    const responses = await Promise.all([
      claim({ participantId: 'person02' }),
      claim({ participantId: 'person02' }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await responses.find((r) => r.status === 409)!.json()).toMatchObject({
      reason: 'taken',
    });
    expect(await db.prepare('SELECT rev, doc_rev FROM meetings').first()).toEqual({
      rev: 2,
      doc_rev: 1,
    });
  });
  it('동시에 같은 새 이름을 고르거나 마지막 자리를 골라도 한 명만 더한다', async () => {
    await seed();
    const same = await Promise.all([
      claim({ newName: '같은 친구' }),
      claim({ newName: '같은 친구' }),
    ]);
    expect(same.map((r) => r.status).sort()).toEqual([200, 409]);
    for (let i = 0; i < 6; i++) expect((await claim({ newName: `친구 ${i}` })).status).toBe(200);
    const last = await Promise.all([
      claim({ newName: '마지막 가' }),
      claim({ newName: '마지막 나' }),
    ]);
    expect(last.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await last.find((r) => r.status === 409)!.json()).toMatchObject({ reason: 'full' });
    expect(await count('meeting_replies')).toBe(8);
  });
  it.each([
    {},
    { participantId: 'person02', newName: '친구' },
    { participantId: 'bad' },
    { newName: '' },
    { newName: '   ' },
    { newName: '가'.repeat(21) },
    { newName: 3 },
    { newName: '친구', extra: true },
  ])('잘못된 고르기 입력 %j는 400이다', async (body) => {
    await seed();
    await expectError(await claim(body), 400, 'BAD_REQUEST');
    expect(await count('meeting_tokens')).toBe(1);
  });
  it('61번째 고르기부터 429다', async () => {
    await seed();
    for (let i = 0; i < 60; i++)
      expect((await claim({ participantId: 'person99' })).status).toBe(404);
    await expectError(await claim({ participantId: 'person02' }), 429, 'RATE_LIMITED');
  });
  it('배치가 실패하면 토큰·새 답장·rev가 모두 남지 않는다', async () => {
    await seed();
    await db
      .prepare(
        "CREATE TRIGGER reject_claim BEFORE UPDATE ON meetings BEGIN SELECT RAISE(ABORT, '시험 오류'); END",
      )
      .run();
    await expectError(await claim({ newName: '친구 셋' }), 502, 'UPSTREAM_ERROR');
    expect(await count('meeting_tokens')).toBe(1);
    expect(await count('meeting_replies')).toBe(0);
    expect(await db.prepare('SELECT rev FROM meetings').first()).toEqual({ rev: 1 });
  });
});

describe('참석자 답장', () => {
  async function guest() {
    const response = await handleClaim(claimContext('POST', { participantId: 'person02' }), deps);
    expect(response.status).toBe(200);
    return (await response.json()).guestToken as string;
  }
  it('겹친 답장의 첫 요청이 재시도로 나중에 커밋되면 두 번째보다 큰 시각을 쓴다', async () => {
    await seed();
    const token = await guest();
    const batch = db.batch.bind(db);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let attempts = 0;
    vi.spyOn(db, 'batch').mockImplementation(async (statements) => {
      if (++attempts === 1) {
        entered();
        await gate;
      }
      return batch(statements);
    });
    const first = handleReply(context('PUT', { likes: ['choice01'] }, { token }), {
      ...deps,
      now: () => new Date(NOW.getTime() + 1000),
    });
    await waiting;
    try {
      const second = await handleReply(context('PUT', { likes: [] }, { token }), {
        ...deps,
        now: () => new Date(NOW.getTime() + 2000),
      });
      expect(second.status).toBe(200);
      const committed = await db
        .prepare('SELECT updated_at FROM meeting_replies')
        .first<{ updated_at: string }>();
      expect(committed?.updated_at).toBe('2026-10-26T12:00:02.000Z');
      release();
      expect((await first).status).toBe(200);
      expect(attempts).toBe(3);
      expect(await db.prepare('SELECT likes, updated_at FROM meeting_replies').first()).toEqual({
        likes: '["choice01"]',
        updated_at: '2026-10-26T12:00:02.001Z',
      });
    } finally {
      release();
      await first;
    }
  });

  it('같은 서버 시각의 연속 답장도 기존 시각보다 1ms 크게 저장한다', async () => {
    await seed();
    const token = await guest();
    await handleReply(context('PUT', { likes: [] }, { token }), deps);
    const first = await db
      .prepare('SELECT updated_at FROM meeting_replies')
      .first<{ updated_at: string }>();
    await handleReply(context('PUT', { likes: ['choice01'] }, { token }), deps);
    const second = await db
      .prepare('SELECT updated_at FROM meeting_replies')
      .first<{ updated_at: string }>();
    expect(Date.parse(second!.updated_at)).toBe(Date.parse(first!.updated_at) + 1);
  });
  it('버전 충돌이 계속되면 총 5번 시도 뒤 busy 409를 돌려준다', async () => {
    await seed();
    const token = await guest();
    const batch = db.batch.bind(db);
    let attempts = 0;
    vi.spyOn(db, 'batch').mockImplementation(async (statements) => {
      attempts++;
      // 제한이 사라져도 시험 자체가 끝없이 돌지 않게 한다.
      if (attempts > 5) throw new Error('재시도 한도 초과');
      const results = await batch(statements);
      results[results.length - 1] = { meta: { changes: 0 } };
      return results;
    });

    const response = await handleReply(context('PUT', { likes: [] }, { token }), deps);

    expect(response.status).toBe(409);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      error: { code: 'CONFLICT', message: '잠시 뒤 다시 해 주세요' },
      reason: 'busy',
    });
    expect(attempts).toBe(5);
  });
  it.each(['없음', '잘못된 토큰', '다른 약속'])('%s은 답장 401이다', async (kind) => {
    const host = await seed();
    const token =
      kind === '없음'
        ? undefined
        : kind === '주최자'
          ? host
          : kind === '다른 약속'
            ? await addReply('person02', null, 'another001')
            : 'wrong-token';
    await expectError(
      await handleReply(context('PUT', { likes: [] }, { token }), deps),
      401,
      'UNAUTHORIZED',
    );
  });
  it('주최자 토큰은 본문의 주최자 줄에 좋아요를 쓰고 출발지와 소요시간은 무시한다', async () => {
    const host = await seed();
    const guestToken = await guest();
    expect(
      (await handleReply(context('PUT', { likes: [] }, { token: guestToken }), deps)).status,
    ).toBe(200);
    const response = await handleReply(
      context(
        'PUT',
        {
          likes: ['choice01'],
          origin: changed,
          times: { choice01: 99 },
        },
        { token: host },
      ),
      deps,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rev: 4 });
    expect(
      (
        await db
          .prepare(
            'SELECT participant_id, name, origin, times, likes FROM meeting_replies ORDER BY participant_id',
          )
          .all()
      ).results,
    ).toEqual([
      { participant_id: 'person01', name: '나', origin: null, times: null, likes: '["choice01"]' },
      { participant_id: 'person02', name: '친구', origin: null, times: null, likes: '[]' },
    ]);
    const state = await (
      await handleGet(context('GET', undefined, { token: guestToken }), deps)
    ).json();
    expect(state.replies).toContainEqual(
      expect.objectContaining({ participantId: 'person01', likes: ['choice01'] }),
    );
    expect(state.doc.participants[0].origin).toBeNull();
    expect(state.originNames.person01).toBe('집');
  });

  it('자기 줄만 저장하고 rev·갱신·만료를 올리며 주최자가 읽을 수 있다', async () => {
    const host = await seed();
    const token = await guest();
    deps.now = () => new Date('2026-10-27T12:00:00Z');
    const response = await handleReply(
      context(
        'PUT',
        { likes: ['choice01'], origin: changed, times: { choice01: 25 }, docRev: 1 },
        { token },
      ),
      deps,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ rev: 3 });
    const state = await (await handleGet(context('GET', undefined, { token: host }), deps)).json();
    expect(state).toMatchObject({
      rev: 3,
      docRev: 1,
      replies: [
        {
          participantId: 'person02',
          name: '친구',
          origin: changed,
          likes: ['choice01'],
          times: { choice01: 25 },
          updatedAt: '2026-10-27T12:00:00.000Z',
        },
      ],
    });
    expect(await db.prepare('SELECT updated_at, expires_at FROM meetings').first()).toEqual({
      updated_at: '2026-10-27T12:00:00.000Z',
      expires_at: '2026-11-26T12:00:00.000Z',
    });
  });
  it('다른 참석자 id를 본문에 넣어도 남의 줄을 바꾸지 못한다', async () => {
    await seed();
    const token = await guest();
    await expectError(
      await handleReply(context('PUT', { participantId: 'person01', likes: [] }, { token }), deps),
      400,
      'BAD_REQUEST',
    );
    expect(await count('meeting_replies')).toBe(0);
    expect((await handleReply(context('PUT', { likes: [] }, { token }), deps)).status).toBe(200);
    expect(await db.prepare('SELECT participant_id FROM meeting_replies').all()).toEqual({
      results: [{ participant_id: 'person02' }],
    });
  });
  it('새 참석자는 claim 이름을 보존하고 두 번째 답장은 같은 줄을 덮는다', async () => {
    await seed();
    const response = await handleClaim(claimContext('POST', { newName: '새 친구' }), deps);
    const { guestToken: token, participantId } = await response.json();
    expect(
      (
        await handleReply(
          context(
            'PUT',
            { likes: ['choice01'], origin: changed, times: { choice01: 22 }, docRev: 1 },
            { token },
          ),
          deps,
        )
      ).status,
    ).toBe(200);
    expect(
      (await handleReply(context('PUT', { likes: [], origin: null, times: null }, { token }), deps))
        .status,
    ).toBe(200);
    expect(
      await db
        .prepare('SELECT participant_id, name, origin, likes, times FROM meeting_replies')
        .first(),
    ).toEqual({
      participant_id: participantId,
      name: '새 친구',
      origin: null,
      likes: '[]',
      times: null,
    });
    expect(await count('meeting_replies')).toBe(1);
  });
  it('출발지·시간을 생략하면 이전 값을 보존한다', async () => {
    await seed();
    const token = await guest();
    expect(
      (
        await handleReply(
          context(
            'PUT',
            { likes: ['choice01'], origin: changed, times: { choice01: 12 }, docRev: 1 },
            { token },
          ),
          deps,
        )
      ).status,
    ).toBe(200);
    expect((await handleReply(context('PUT', { likes: [] }, { token }), deps)).status).toBe(200);
    expect(await db.prepare('SELECT origin, times FROM meeting_replies').first()).toEqual({
      origin: JSON.stringify(changed),
      times: '{"choice01":12}',
    });
  });
  it.each([
    { likes: ['choice99'] },
    { likes: [], times: { choice99: 12 }, docRev: 1 },
    { likes: ['choice01', 'choice01'] },
    { likes: [], origin: { name: '밖', lng: 0, lat: 0 } },
    { likes: [], times: { choice01: -1 } },
    { likes: [], extra: true },
    {},
  ])('잘못된 답장 %j는 400이고 rev를 유지한다', async (body) => {
    await seed();
    const token = await guest();
    await expectError(await handleReply(context('PUT', body, { token }), deps), 400, 'BAD_REQUEST');
    expect(await db.prepare('SELECT rev, doc_rev FROM meetings').first()).toEqual({
      rev: 2,
      doc_rev: 1,
    });
  });
  it('601번째 답장은 429다', async () => {
    await seed();
    const token = await guest();
    await db
      .prepare('INSERT INTO rate_counters VALUES (?, 600)')
      .bind(`reply:${await hashIp('192.0.2.10', 'dev-salt')}:2026-10-26`)
      .run();
    await expectError(
      await handleReply(context('PUT', { likes: [] }, { token }), deps),
      429,
      'RATE_LIMITED',
    );
  });
  it('배치가 실패하면 답장·rev가 모두 바뀌지 않는다', async () => {
    await seed();
    const token = await guest();
    await db
      .prepare(
        "CREATE TRIGGER reject_reply BEFORE UPDATE ON meetings BEGIN SELECT RAISE(ABORT, '시험 오류'); END",
      )
      .run();
    await expectError(
      await handleReply(context('PUT', { likes: ['choice01'] }, { token }), deps),
      502,
      'UPSTREAM_ERROR',
    );
    expect(await count('meeting_replies')).toBe(0);
    expect(await db.prepare('SELECT rev FROM meetings').first()).toEqual({ rev: 2 });
  });
});

describe('참석자 풀기와 주최자 재발급', () => {
  it('답장을 남긴 채 차지를 풀고 이전 토큰을 철회하며 다른 토큰으로 다시 고른다', async () => {
    const host = await seed();
    const old = await addReply();
    const before = await db.prepare('SELECT * FROM meeting_replies').first();
    const response = await handleRelease(
      context('POST', { participantId: 'person02' }, { token: host }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ rev: 2 });
    expect(await db.prepare('SELECT * FROM meeting_replies').first()).toEqual(before);
    await expectError(
      await handleGet(context('GET', undefined, { token: old }), deps),
      401,
      'UNAUTHORIZED',
    );
    await expectError(
      await handleReply(context('PUT', { likes: [] }, { token: old }), deps),
      401,
      'UNAUTHORIZED',
    );
    const claimed = await handleClaim(claimContext('POST', { participantId: 'person02' }), deps);
    expect(claimed.status).toBe(200);
    expect((await claimed.json()).guestToken).not.toBe(old);
    expect(await db.prepare('SELECT rev, doc_rev FROM meetings').first()).toEqual({
      rev: 3,
      doc_rev: 1,
    });
  });
  it('본문에 없는 새 참석자도 이름으로 다시 고르고 기존 답장은 남긴다', async () => {
    const host = await seed();
    const first = await handleClaim(claimContext('POST', { newName: '새 친구' }), deps);
    const { participantId, guestToken } = await first.json();
    expect(
      (await handleReply(context('PUT', { likes: ['choice01'] }, { token: guestToken }), deps))
        .status,
    ).toBe(200);
    expect(
      (await handleRelease(context('POST', { participantId }, { token: host }), deps)).status,
    ).toBe(200);
    const next = await handleClaim(claimContext('POST', { newName: ' 새 친구 ' }), deps);
    expect(next.status).toBe(200);
    expect(await next.json()).toMatchObject({ participantId });
    expect(await db.prepare('SELECT likes FROM meeting_replies').first()).toEqual({
      likes: '["choice01"]',
    });
  });
  it('같은 새 토큰의 재발급 재시도는 철회된 인증으로도 버전을 바꾸지 않고 성공한다', async () => {
    const old = await seed();
    const hostToken = newToken();
    const body = { host: true, hostToken };
    const first = await handleRelease(context('POST', body, { token: old }), deps);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ rev: 2, hostToken });
    const retry = await handleRelease(context('POST', body, { token: old }), deps);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ rev: 2, hostToken });
    expect(await db.prepare('SELECT rev, doc_rev FROM meetings').first()).toEqual({
      rev: 2,
      doc_rev: 1,
    });
    expect(await count('meeting_tokens')).toBe(1);
    await expectError(
      await handleRelease(
        context('POST', { host: true, hostToken: newToken() }, { token: old }),
        deps,
      ),
      401,
      'UNAUTHORIZED',
    );
    await expectError(
      await handleRelease(
        context('POST', { host: true, hostToken: newToken() }, { token: 'wrong' }),
        deps,
      ),
      401,
      'UNAUTHORIZED',
    );
  });
  it('주최자 토큰 재발급은 이전 토큰을 철회하고 새 토큰만 전체 좌표를 읽는다', async () => {
    const old = await seed();
    const response = await handleRelease(
      context('POST', { host: true, hostToken: newToken() }, { token: old }),
      deps,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rev).toBe(2);
    expect(body.hostToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.hostToken).not.toBe(old);
    await expectError(
      await handleGet(context('GET', undefined, { token: old }), deps),
      401,
      'UNAUTHORIZED',
    );
    await expectError(
      await handleUpdate(context('PUT', { doc: doc(), baseRev: 1 }, { token: old }), deps),
      401,
      'UNAUTHORIZED',
    );
    expect(
      (await handleGet(context('GET', undefined, { token: body.hostToken }), deps)).status,
    ).toBe(200);
    expect(
      (await (await handleGet(context('GET', undefined, { token: body.hostToken }), deps)).json())
        .doc.participants[0].origin,
    ).toEqual(home);
    expect(await db.prepare("SELECT hash FROM meeting_tokens WHERE kind = 'host'").all()).toEqual({
      results: [{ hash: await hashToken(body.hostToken) }],
    });
    expect(await db.prepare('SELECT rev, doc_rev FROM meetings').first()).toEqual({
      rev: 2,
      doc_rev: 1,
    });
  });
  it.each([undefined, 'wrong', 'guest'])('주최자가 아닌 토큰 %s는 풀기 401이다', async (kind) => {
    await seed();
    const token = kind === 'guest' ? await addReply() : kind;
    await expectError(
      await handleRelease(context('POST', { participantId: 'person02' }, { token }), deps),
      401,
      'UNAUTHORIZED',
    );
  });
  it.each([
    {},
    { host: false },
    { host: true, participantId: 'person02' },
    { participantId: 'bad' },
    { host: true, extra: 1 },
  ])('잘못된 풀기 %j는 400이다', async (body) => {
    const token = await seed();
    await expectError(
      await handleRelease(context('POST', body, { token }), deps),
      400,
      'BAD_REQUEST',
    );
  });
  it('재발급 배치가 실패하면 원래 주최자 토큰을 보존한다', async () => {
    const token = await seed();
    await db
      .prepare(
        "CREATE TRIGGER reject_release BEFORE UPDATE ON meetings BEGIN SELECT RAISE(ABORT, '시험 오류'); END",
      )
      .run();
    await expectError(
      await handleRelease(context('POST', { host: true, hostToken: newToken() }, { token }), deps),
      502,
      'UPSTREAM_ERROR',
    );
    expect(await db.prepare("SELECT hash FROM meeting_tokens WHERE kind = 'host'").first()).toEqual(
      { hash: await hashToken(token) },
    );
  });
});

describe('고르기·답장·풀기 공통 검사', () => {
  it.each([handleClaim, handleReply, handleRelease])(
    '출처·경로·만료를 검사한다 %#',
    async (handler) => {
      await expectError(
        await handler(context('POST', {}, { origin: 'https://evil.example' }), deps),
        403,
        'FORBIDDEN_ORIGIN',
      );
      await expectError(
        await handler(context('POST', {}, { id: 'bad' }), deps),
        400,
        'BAD_REQUEST',
      );
      await expectError(await handler(context('POST', {}), deps), 404, 'NOT_FOUND');
      await seed();
      await db.prepare('UPDATE meetings SET expires_at = ?').bind(NOW.toISOString()).run();
      await expectError(await handler(context('POST', {}), deps), 410, 'ENDED');
    },
  );
  it('기능 스위치가 꺼져도 기존 약속의 고르기·답장·풀기는 허용한다', async () => {
    const host = await seed();
    env.MEET_ONLINE = 'off';
    const response = await handleClaim(claimContext('POST', { participantId: 'person02' }), deps);
    expect(response.status).toBe(200);
    const { guestToken: token } = await response.json();
    expect((await handleReply(context('PUT', { likes: [] }, { token }), deps)).status).toBe(200);
    expect(
      (await handleRelease(context('POST', { participantId: 'person02' }, { token: host }), deps))
        .status,
    ).toBe(200);
  });
});

it.each([undefined, 1, 2])(
  '소요시간 본문 버전 %s를 현재 버전과 비교해 시간만 저장하거나 버린다',
  async (docRev) => {
    const host = await seed();
    const claim = await handleClaim(claimContext('POST', { participantId: 'person02' }), deps);
    const { guestToken: token } = await claim.json();
    expect(
      (
        await handleUpdate(
          context('PUT', { doc: doc({ mode: 'car' }), baseRev: 1 }, { token: host }),
          deps,
        )
      ).status,
    ).toBe(200);
    const response = await handleReply(
      context(
        'PUT',
        {
          likes: ['choice01'],
          origin: changed,
          times: { choice01: 25 },
          ...(docRev === undefined ? {} : { docRev }),
        },
        { token },
      ),
      deps,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      rev: 4,
      ...(docRev === 2 ? {} : { timesDropped: true }),
    });
    expect(await db.prepare('SELECT times, likes, origin FROM meeting_replies').first()).toEqual({
      times: docRev === 2 ? '{"choice01":25}' : null,
      likes: '["choice01"]',
      origin: JSON.stringify(changed),
    });
  },
);

it.each([false, true])(
  '본문 10명과 답장 전용 1명의 갱신은 409 full이다(동시 차지=%s)',
  async (racing) => {
    const token = await seed();
    const next = doc({
      participants: [
        ...doc().participants,
        ...Array.from({ length: 8 }, (_, i) => ({
          id: `extra00${i}`,
          name: `추가${i}`,
          origin: null,
        })),
      ],
    });
    const add = async () => {
      const result = await handleClaim(claimContext('POST', { newName: '답장 전용' }), deps);
      expect(result.status).toBe(200);
    };
    if (racing) {
      const batch = db.batch.bind(db);
      vi.spyOn(db, 'batch').mockImplementationOnce(async (statements) => {
        await add();
        return batch(statements);
      });
    } else await add();
    const response = await handleUpdate(context('PUT', { doc: next, baseRev: 1 }, { token }), deps);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: 'full' });
    expect(await db.prepare('SELECT doc, doc_rev FROM meetings').first()).toEqual({
      doc: JSON.stringify(doc()),
      doc_rev: 1,
    });
    expect(await count('meeting_replies')).toBe(1);
  },
);

it('removed의 답장·토큰과 옛 본문에서 빠진 참석자를 함께 지워 옛 토큰은 401이다', async () => {
  const token = await seed();
  await addReply();
  const guestToken = await addReply('person03');
  await addReply('person04');
  const next = doc({ participants: [doc().participants[0]!], times: {} });
  const response = await handleUpdate(
    context('PUT', { doc: next, baseRev: 1, removed: ['person03'] }, { token }),
    deps,
  );
  expect(response.status).toBe(200);
  expect((await db.prepare('SELECT participant_id FROM meeting_replies').all()).results).toEqual([
    { participant_id: 'person04' },
  ]);
  expect(
    (await db.prepare("SELECT participant_id FROM meeting_tokens WHERE kind = 'guest'").all())
      .results,
  ).toEqual([{ participant_id: 'person04' }]);
  await expectError(
    await handleReply(context('PUT', { likes: [] }, { token: guestToken }), deps),
    401,
    'UNAUTHORIZED',
  );
});

it('removed에 주최자와 새 본문에 남는 참석자를 넣어도 답장과 토큰을 지키고 중복 id를 받는다', async () => {
  const token = await seed();
  await addReply('person01');
  await addReply();
  await addReply('person03');
  const response = await handleUpdate(
    context(
      'PUT',
      { doc: doc(), baseRev: 1, removed: ['person01', 'person02', 'person03', 'person03'] },
      { token },
    ),
    deps,
  );
  expect(response.status).toBe(200);
  expect(
    (await db.prepare('SELECT participant_id FROM meeting_replies ORDER BY participant_id').all())
      .results,
  ).toEqual([{ participant_id: 'person01' }, { participant_id: 'person02' }]);
  expect(await count('meeting_tokens')).toBe(3);
});

it('본문 버전이 배치 전에 바뀌면 removed의 답장과 토큰도 지우지 않는다', async () => {
  const token = await seed();
  await addReply('person03');
  const batch = db.batch.bind(db);
  vi.spyOn(db, 'batch').mockImplementationOnce(async (statements) => {
    await db.prepare('UPDATE meetings SET doc_rev = doc_rev + 1, rev = rev + 1').run();
    return batch(statements);
  });
  await expectError(
    await handleUpdate(
      context('PUT', { doc: doc(), baseRev: 1, removed: ['person03'] }, { token }),
      deps,
    ),
    409,
    'CONFLICT',
  );
  expect(await count('meeting_replies')).toBe(1);
  expect(await count('meeting_tokens')).toBe(2);
});

it.each([
  null,
  'person03',
  ['bad'],
  Array.from({ length: 11 }, (_, i) => `person${String(i).padStart(2, '0')}`),
])('removed의 깨진 값 %j는 400이다', async (removed) => {
  const token = await seed();
  await expectError(
    await handleUpdate(context('PUT', { doc: doc(), baseRev: 1, removed }, { token }), deps),
    400,
    'BAD_REQUEST',
  );
});
