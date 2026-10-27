// @vitest-environment node
import type { BrowserContext, Route } from '@playwright/test';
import { afterEach, expect, it, vi } from 'vitest';
import { docFromMeeting } from '../../../src/domain/meeting/online-doc';
import { createMeetServer, installMeetServer } from '../../e2e/meet-server';
import { newToken } from '../../../src/server/meet/tokens';
import { buildMeeting } from '../../fixtures/builders';

const servers: ReturnType<typeof createMeetServer>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});
function server() {
  const value = createMeetServer();
  servers.push(value);
  return value;
}

/** 포트를 열지 않고 Playwright 경계만 대신한다. 요청 처리는 실제 서버와 SQLite가 맡는다. */
async function browserContext(shared: ReturnType<typeof createMeetServer>) {
  const register =
    vi.fn<(pattern: string, handler: (route: Route) => Promise<void>) => Promise<void>>();
  await installMeetServer({ route: register } as unknown as BrowserContext, shared);
  expect(register.mock.calls[0]?.[0]).toBe('**/api/meet**');
  const handler = register.mock.calls[0]![1];
  return async (path: string, method = 'GET', body?: unknown, token?: string) => {
    let response: Response | null = null;
    const fallback = vi.fn();
    const request = new Request(`http://localhost:5175${path}`, {
      method,
      headers: {
        Origin: 'http://localhost:5175',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    await handler({
      request: () => ({
        url: () => request.url,
        method: () => request.method,
        allHeaders: async () => Object.fromEntries(request.headers),
        postData: () => (body === undefined ? null : JSON.stringify(body)),
      }),
      fulfill: async (options: {
        status: number;
        headers: Record<string, string>;
        body: Buffer;
      }) => {
        response = new Response(
          options.status === 204 || options.status === 304 ? null : new Uint8Array(options.body),
          options,
        );
      },
      fallback,
    } as unknown as Route);
    return { response: response as Response | null, fallback };
  };
}

it('5175 출처를 정규화하고 네 문맥이 같은 DB에서 올리기·답장·확정·풀기·삭제를 이어간다', async () => {
  const shared = server();
  const [host, friend, rival, otherHost] = await Promise.all([
    browserContext(shared),
    browserContext(shared),
    browserContext(shared),
    browserContext(shared),
  ]);
  const original = docFromMeeting(buildMeeting(), {}, 'min');
  const doc = {
    ...original,
    participants: [...original.participants, { id: 'person02', name: '친구', origin: null }],
  };
  const created = (
    await host('/api/meet', 'POST', { doc, turnstile: 'dev', hostToken: newToken() })
  ).response!;
  expect(created.status).toBe(201);
  expect(created.headers.get('Cache-Control')).toBe('private, no-store');
  const { hostToken } = await created.json();
  const path = `/api/meet/${doc.meetingId}`;
  const claim = (
    await friend(`${path}/claim`, 'POST', { participantId: 'person02', guestToken: newToken() })
  ).response!;
  expect(claim.status).toBe(200);
  const { guestToken } = await claim.json();
  const taken = (
    await rival(`${path}/claim`, 'POST', { participantId: 'person02', guestToken: newToken() })
  ).response!;
  expect(taken.status).toBe(409);
  expect(await taken.json()).toMatchObject({ reason: 'taken' });
  expect(
    (await friend(`${path}/reply`, 'PUT', { likes: ['choice01'] }, guestToken)).response!.status,
  ).toBe(200);
  const state = (await host(path, 'GET', undefined, hostToken)).response!;
  expect(state.status).toBe(200);
  const snapshot = await state.json();
  expect(snapshot.replies).toMatchObject([{ participantId: 'person02', likes: ['choice01'] }]);
  const unchanged = (await host(`${path}?since=${snapshot.rev}`, 'GET', undefined, hostToken))
    .response!;
  expect(unchanged.status).toBe(304);
  expect(await unchanged.text()).toBe('');
  const finalDoc = { ...doc, decided: 'choice01' };
  expect(
    (await host(path, 'PUT', { doc: finalDoc, baseRev: snapshot.docRev }, hostToken)).response!
      .status,
  ).toBe(200);
  expect(await (await friend(path)).response!.json()).toMatchObject({
    doc: { decided: 'choice01' },
  });
  expect(await (await otherHost(path, 'GET', undefined, hostToken)).response!.json()).toMatchObject(
    { doc: finalDoc, replies: snapshot.replies },
  );
  expect(
    (await host(`${path}/release`, 'POST', { participantId: 'person02' }, hostToken)).response!
      .status,
  ).toBe(200);
  expect((await friend(`${path}/reply`, 'PUT', { likes: [] }, guestToken)).response!.status).toBe(
    401,
  );
  expect(
    (await rival(`${path}/claim`, 'POST', { participantId: 'person02', guestToken: newToken() }))
      .response!.status,
  ).toBe(200);
  const removed = (await host(path, 'DELETE', undefined, hostToken)).response!;
  expect(removed.status).toBe(204);
  expect(await removed.text()).toBe('');
  expect((await friend(path)).response!.status).toBe(404);
});

it('시험마다 DB와 일 한도를 분리한다', async () => {
  const first = await browserContext(server());
  const second = await browserContext(server());
  const doc = docFromMeeting(buildMeeting(), {}, 'min');
  expect(
    (await first('/api/meet', 'POST', { doc, turnstile: 'dev', hostToken: newToken() })).response!
      .status,
  ).toBe(201);
  // 같은 IP의 중복 올리기도 한도를 소비한다. 다른 시험의 DB에는 전파되지 않는다.
  for (let i = 1; i < 20; i++) {
    expect(
      (await first('/api/meet', 'POST', { doc, turnstile: 'dev', hostToken: newToken() })).response!
        .status,
    ).toBe(409);
  }
  expect(
    (await first('/api/meet', 'POST', { doc, turnstile: 'dev', hostToken: newToken() })).response!
      .status,
  ).toBe(429);
  expect((await second(`/api/meet/${doc.meetingId}`)).response!.status).toBe(404);
  expect(
    (await second('/api/meet', 'POST', { doc, turnstile: 'dev', hostToken: newToken() })).response!
      .status,
  ).toBe(201);
});

it('API 경로·메서드가 아닌 요청은 다음 가로채기로 넘긴다', async () => {
  const request = await browserContext(server());
  for (const [path, method] of [
    ['/api/meetings', 'GET'],
    ['/api/meet', 'GET'],
    ['/api/meet/meeting001/claim', 'PUT'],
  ]) {
    const result = await request(path!, method);
    expect(result.fallback).toHaveBeenCalledOnce();
    expect(result.response).toBeNull();
  }
});
