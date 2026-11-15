// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isAdmin } from 'src/server/library-sync/recommend';
import type { ShareDocV1 } from 'src/schema/share';
import { createSyncMemoryServer } from '../../helpers/sync-memory-server';

let server: ReturnType<typeof createSyncMemoryServer>;
let session: string;
let clock: number;
const doc: ShareDocV1 = {
  format: 'tripmap-share',
  version: 1,
  title: '옛 제목',
  createdAt: '2026-11-01T00:00:00.000Z',
  labels: [],
  places: [{ id: 'place001', name: '단풍길', address: '서울', lng: 127, lat: 37.5, labelIds: [] }],
};
const body = {
  title: '가을 단풍',
  description: '함께 걸어요',
  startDate: '2026-11-15',
  endDate: '2026-11-16',
  doc,
};
function request(method = 'GET', value?: unknown, path = '/recommendations', sid = session) {
  return server.fetch('http://localhost:8795/api/sync/v1' + path, {
    method,
    headers: {
      Origin: 'http://localhost:8795',
      'X-Landmark-Session': sid,
      'Content-Type': 'application/json',
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
}
const publish = (value: unknown = body, id = 'label001', sid = session) =>
  request('POST', value, '/admin/recommendations/' + id, sid);
beforeEach(async () => {
  clock = Date.parse('2026-11-15T00:00:00+09:00');
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  server = createSyncMemoryServer({
    ADMIN_ACCOUNTS: 'kakao:dev-me',
    ALLOWED_ACCOUNTS: 'kakao:dev-me,kakao:dev-you',
  });
  session = await server.login();
});
afterEach(() => {
  vi.restoreAllMocks();
  server.db.close();
});
it('관리자 목록은 비어 있으면 닫히고 Google 이메일은 대소문자를 가리지 않는다', () => {
  const user = { provider: 'kakao', account: 'dev-me' } as const;
  expect(isAdmin({}, user)).toBe(false);
  expect(isAdmin({ ADMIN_ACCOUNTS: ' , ' }, user)).toBe(false);
  expect(isAdmin({ ADMIN_ACCOUNTS: ' kakao:dev-me,naver:other ' }, user)).toBe(true);
  expect(isAdmin({ ADMIN_ACCOUNTS: 'kakao:other' }, user)).toBe(false);
  expect(
    isAdmin({ ADMIN_ACCOUNTS: 'google:A@B.com' }, { provider: 'google', account: 'a@b.com' }),
  ).toBe(true);
});
it('비로그인은 401, 관리자가 아닌 계정은 403으로 거절한다', async () => {
  expect((await publish(body, 'label001', '')).status).toBe(401);
  const response = await publish(body, 'label001', await server.login('you'));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: 'not-admin' });
});
it('잘못된 실제 날짜와 id는 422로 거절한다', async () => {
  for (const startDate of ['2026-13-01', '2026-02-30'])
    expect((await publish({ ...body, startDate })).status).toBe(422);
  expect((await publish(body, 'BAD')).status).toBe(422);
});
it('게시한 추천은 KST 시작일과 종료일 양 끝에만 공개한다', async () => {
  expect((await publish()).status).toBe(200);
  for (const [time, count] of [
    ['2026-11-14T23:59:59+09:00', 0],
    ['2026-11-15T00:00:00+09:00', 1],
    ['2026-11-16T23:59:59+09:00', 1],
    ['2026-11-17T00:00:00+09:00', 0],
  ] as const) {
    clock = Date.parse(time);
    expect(
      (await (await request('GET', undefined, '/recommendations', '')).json()).items,
    ).toHaveLength(count);
  }
});
it('라벨이나 메모가 든 문서와 문서 없는 새 행을 거절한다', async () => {
  for (const changed of [
    { ...doc, labels: [{ id: 'label001', name: '비공개', color: 'red', order: 0 }] },
    { ...doc, places: [{ ...doc.places[0], labelIds: ['label001'] }] },
    { ...doc, places: [{ ...doc.places[0], memo: '' }] },
  ])
    expect((await publish({ ...body, doc: changed })).status).toBe(422);
  const meta = {
    title: body.title,
    description: body.description,
    startDate: body.startDate,
    endDate: body.endDate,
  };
  expect((await publish(meta)).status).toBe(422);
});
it('같은 id의 메타만 덮어쓰면 문서와 생성 시각을 보존한다', async () => {
  const first = (await (await publish()).json()).item;
  clock += 1000;
  const meta = {
    title: body.title,
    description: body.description,
    startDate: body.startDate,
    endDate: body.endDate,
  };
  expect((await publish({ ...meta, title: '새 제목' })).status).toBe(200);
  const item = (await (await request()).json()).items[0];
  expect(item).toMatchObject({
    title: '새 제목',
    doc,
    createdAt: first.createdAt,
    updatedAt: clock,
  });
  const listed = (await (await request('GET', undefined, '/admin/recommendations')).json())
    .items[0];
  expect(listed.doc).toBeUndefined();
});
it('새 행은 30개까지이고 기존 행은 다시 게시할 수 있다', async () => {
  for (let i = 0; i < 30; i++)
    expect((await publish(body, 'l' + String(i).padStart(7, '0'))).status).toBe(200);
  const response = await publish();
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: 'too-many' });
  expect((await publish(body, 'l0000000')).status).toBe(200);
});
it('동기화를 꺼도 공개 목록과 내리기는 되고 게시는 멈춘다', async () => {
  await publish();
  server.env.LIBRARY_SYNC = 'off';
  expect((await request()).status).toBe(200);
  expect((await request('GET', undefined, '/admin/recommendations')).status).toBe(200);
  expect((await publish()).status).toBe(503);
  expect((await request('DELETE', undefined, '/admin/recommendations/label001')).status).toBe(204);
});
