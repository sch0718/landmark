// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeCompressedJson } from 'src/domain/codec';
import { ITEM_DOC_MAX_CHARS, stableStringify } from 'src/domain/library-sync/items';
import { AGENT_INBOX_LIMITS } from 'src/domain/share/agent-limits';
import { readShareHash } from 'src/domain/share/read-share';
import type { ShareDoc, ShareDocV2 } from 'src/schema/share';
import {
  checkInboxDoc,
  deleteInboxItem,
  INBOX_MAX_PENDING,
  INBOX_PRUNE_MAX,
  INBOX_TTL_MS,
  listInbox,
  parseInboxBody,
  pruneInbox,
  putInbox,
  readInboxItem,
  type InboxBody,
} from 'src/server/agent/inbox';
import { SyncHttpError, syncError } from 'src/server/library-sync/http';
import { ensureSchema } from 'src/server/meet/db';
import { hashToken } from 'src/server/meet/tokens';
import { encodeShareHash, hashDoc } from 'src/share-viewer/encode';
import { createSqliteD1 } from '../../helpers/sqlite-d1';
import { importedAgentLibrary, largeAgentDoc } from '../../helpers/agent-import-doc';

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/agent-trip/doc.json', import.meta.url), 'utf8'),
) as ShareDocV2;
const NOW = Date.UTC(2026, 10, 1);
const DAY = 24 * 60 * 60 * 1000;
const principal = { userId: '내사용자', tokenId: '시험연결' };
const meta = {
  title: fixture.trips[0]!.title,
  startDate: fixture.trips[0]!.startDate,
  endDate: fixture.trips[0]!.endDate,
  places: fixture.places.length,
};
const randomKey = () => randomBytes(32).toString('base64url');
const randomId = () => randomBytes(12).toString('base64url');
const tripDoc = () => structuredClone(fixture) as ShareDocV2;
const encode = (doc: ShareDoc) => encodeShareHash(hashDoc(doc));
const invalid = (reason: string) => ({ status: 422, code: 'invalid', extra: { reason } });

let db: ReturnType<typeof createSqliteD1>;
let body: InboxBody;
let secret: string;
let logs: ReturnType<typeof vi.spyOn>[];

beforeEach(async () => {
  logs = ['log', 'info', 'warn', 'error', 'debug'].map((method) =>
    vi.spyOn(console, method as 'log').mockImplementation(() => undefined),
  );
  db = createSqliteD1();
  await ensureSchema(db);
  secret = randomKey();
  await db
    .prepare('INSERT INTO agent_tokens VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(
      principal.tokenId,
      principal.userId,
      await hashToken(secret),
      '여행 도우미',
      'inbox:write',
      NOW,
      NOW + 90 * DAY,
      null,
      null,
    )
    .run();
  body = { v: 1, key: randomKey(), d: await encode(tripDoc()) };
});

afterEach(() => {
  const output = JSON.stringify(logs.flatMap((log) => log.mock.calls));
  vi.restoreAllMocks();
  db.close();
  expect(output.includes(secret)).toBe(false);
  expect(output.includes(body.d)).toBe(false);
});

async function fill(count: number, now = NOW) {
  for (let i = 0; i < count; i++) {
    await putInbox(db, principal, { ...body, key: randomKey() }, meta, randomId(), now);
  }
}

describe('받은함 본문', () => {
  it('정확히 세 필드의 본문과 데이터 길이 경계를 받는다', () => {
    expect(parseInboxBody(body)).toEqual(body);
    expect(parseInboxBody({ ...body, d: 'a' }).d).toBe('a');
    expect(parseInboxBody({ ...body, d: 'a'.repeat(32_000) }).d.length).toBe(32_000);
  });

  it.each([
    ['null', () => null],
    ['배열', () => []],
    ['문자열', () => '본문'],
    ['빈 객체', () => ({})],
    ['모르는 키', () => ({ ...body, userId: '다른사용자' })],
    ['잘못된 버전', () => ({ ...body, v: 2 })],
    ['문자열 버전', () => ({ ...body, v: '1' })],
    ['짧은 키', () => ({ ...body, key: 'a'.repeat(42) })],
    ['긴 키', () => ({ ...body, key: 'a'.repeat(44) })],
    ['키의 금지 문자', () => ({ ...body, key: '+'.repeat(43) })],
    ['키의 줄바꿈', () => ({ ...body, key: `${body.key}\n` })],
    ['숫자 키', () => ({ ...body, key: 1 })],
    ['빈 데이터', () => ({ ...body, d: '' })],
    ['긴 데이터', () => ({ ...body, d: 'a'.repeat(32_001) })],
    ['데이터의 금지 문자', () => ({ ...body, d: '#d=abc' })],
    ['데이터의 줄바꿈', () => ({ ...body, d: `${body.d}\n` })],
    ['객체 데이터', () => ({ ...body, d: {} })],
  ])('%s를 422 invalid로 거절한다', (_name, value) => {
    expect(() => parseInboxBody(value())).toThrowError(new SyncHttpError(422, 'invalid'));
    try {
      parseInboxBody(value());
    } catch (error) {
      expect(error).toMatchObject({ status: 422, code: 'invalid', extra: {} });
    }
  });
});

describe('받은함 문서', () => {
  it('장소 200곳·30일·Stop 줄바꿈 메모 500자의 가져온 여행이 크기 상한을 넘으면 거절한다', async () => {
    const doc = largeAgentDoc();
    const trip = Object.values(importedAgentLibrary(doc).trips)[0]!;
    expect(stableStringify(trip).length).toBeGreaterThan(ITEM_DOC_MAX_CHARS);
    const d = await encode(doc);
    expect(d.length).toBeLessThanOrEqual(AGENT_INBOX_LIMITS.hashChars);
    expect((await readShareHash(d, AGENT_INBOX_LIMITS)).ok).toBe(true);
    await expect(checkInboxDoc(d)).rejects.toMatchObject(invalid('item-too-large'));
  });

  it('라벨 2,000개를 실은 작은 문서는 모의 가져오기 전에 labels로 거절한다', async () => {
    const doc = tripDoc();
    doc.labels = Array.from({ length: 2000 }, (_, i) => ({
      id: `l${i}`,
      name: `라벨${i}`,
      color: 'blue' as const,
      order: i,
    }));
    doc.places[0] = { ...doc.places[0]!, labelIds: doc.labels.map((label) => label.id) };
    const d = await encode(doc);
    expect(d.length).toBeLessThanOrEqual(AGENT_INBOX_LIMITS.hashChars);
    expect((await readShareHash(d, AGENT_INBOX_LIMITS)).ok).toBe(true);
    await expect(checkInboxDoc(d)).rejects.toMatchObject(invalid('labels'));
  });

  it('가져온 여행 항목이 동기화 상한 바로 아래인 199,999자면 받는다', async () => {
    const doc = largeAgentDoc();
    const size = () => stableStringify(Object.values(importedAgentLibrary(doc).trips)[0]!).length;
    let excess = size() - (ITEM_DOC_MAX_CHARS - 1);
    expect(excess).toBeGreaterThan(0);
    for (const day of doc.trips[0]!.days) {
      for (const stop of day.stops) {
        const replace = Math.min(excess, stop.note!.length);
        stop.note = '가'.repeat(replace) + stop.note!.slice(replace);
        excess -= replace;
      }
    }
    expect(size()).toBe(ITEM_DOC_MAX_CHARS - 1);
    await expect(checkInboxDoc(await encode(doc))).resolves.toEqual({
      title: '상한 여행',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      places: 200,
    });
  });

  it('압축한 v2 문서에서 목록용 정보를 꺼낸다', async () => {
    const doc = tripDoc();
    doc.title = '문서 제목';
    doc.trips[0]!.title = '여행 제목';
    await expect(checkInboxDoc(await encode(doc))).resolves.toEqual({
      ...meta,
      title: '여행 제목',
    });
  });

  it('여행 제목이 비면 문서 제목을 쓴다', async () => {
    const doc = tripDoc();
    doc.trips[0]!.title = '';
    await expect(checkInboxDoc(await encode(doc))).resolves.toEqual(meta);
  });

  it('v1 장소 문서는 스키마 검사 전에 not-trip으로 거절한다', async () => {
    const source = tripDoc();
    const doc = {
      format: source.format,
      title: source.title,
      createdAt: source.createdAt,
      labels: source.labels,
      places: source.places,
    };
    await expect(checkInboxDoc(await encode({ ...doc, version: 1 }))).rejects.toMatchObject(
      invalid('not-trip'),
    );
  });

  it.each(['문서', '여행'])('%s 제목 61자는 title로 거절한다', async (kind) => {
    const doc = tripDoc();
    if (kind === '문서') doc.title = '가'.repeat(61);
    else doc.trips[0]!.title = '가'.repeat(61);
    await expect(checkInboxDoc(await encode(doc))).rejects.toMatchObject(invalid('title'));
  });

  it.each([
    ['name', '가'.repeat(101)],
    ['address', '가'.repeat(201)],
    ['memo', '가'.repeat(10_001)],
    ['naverSid', '1'.repeat(21)],
    ['kakaoId', '1'.repeat(21)],
    ['googleId', 'a'.repeat(65)],
  ])('장소 %s 한도 초과는 place-too-long이다', async (field, value) => {
    const doc = tripDoc();
    Object.assign(doc.places[0]!, { [field]: value });
    await expect(checkInboxDoc(await encode(doc))).rejects.toMatchObject(invalid('place-too-long'));
  });

  it('제목과 장소 필드의 최대 길이는 받는다', async () => {
    const doc = tripDoc();
    doc.title = doc.trips[0]!.title = '가'.repeat(60);
    Object.assign(doc.places[0]!, {
      name: '가'.repeat(100),
      address: '가'.repeat(200),
      memo: '가'.repeat(10_000),
      naverSid: '1'.repeat(20),
      kakaoId: '2'.repeat(20),
      googleId: 'a'.repeat(64),
    });
    await expect(checkInboxDoc(await encode(doc))).resolves.toEqual({ ...meta, title: doc.title });
  });

  it('둘째 날 전날 숙소에서 출발하는 실제 구간 설정을 받는다', async () => {
    const doc = tripDoc();
    const trip = doc.trips[0]!;
    trip.legModes[`${trip.days[0]!.lodgingId}>${trip.days[1]!.stops[0]!.placeId}`] = 'walk';
    await expect(checkInboxDoc(await encode(doc))).resolves.toEqual(meta);
  });

  it('실제 구간의 반대 방향은 leg-modes로 거절한다', async () => {
    const doc = tripDoc();
    const leg = doc.trips[0]!.days[0]!.legs[0]!;
    doc.trips[0]!.legModes[`${leg.to}>${leg.from}`] = 'car';
    await expect(checkInboxDoc(await encode(doc))).rejects.toMatchObject(invalid('leg-modes'));
  });

  it('장소 100곳의 실제 구간 아닌 설정 6,700개를 leg-modes로 거절한다', async () => {
    const doc = tripDoc();
    doc.places = Array.from({ length: 100 }, (_, i) => ({ ...doc.places[0]!, id: `p${i}` }));
    const trip = doc.trips[0]!;
    trip.startDate = trip.endDate;
    trip.originId = null;
    trip.candidateIds = doc.places.map((p) => p.id);
    trip.days = [{ startTime: '09:00', lodgingId: null, stops: [], legs: [] }];
    trip.legModes = {};
    for (const from of doc.places) {
      for (const to of doc.places) {
        if (from.id !== to.id && Object.keys(trip.legModes).length < 6_700) {
          trip.legModes[`${from.id}>${to.id}`] = 'car';
        }
      }
    }
    const d = await encode(doc);
    expect(Object.keys(trip.legModes)).toHaveLength(6_700);
    expect(d.length).toBeLessThanOrEqual(32_000);
    expect((await readShareHash(d, AGENT_INBOX_LIMITS)).ok).toBe(true);
    await expect(checkInboxDoc(d)).rejects.toMatchObject(invalid('leg-modes'));
  });

  it('압축 길이가 상한 안이어도 풀린 크기 384KB 초과는 corrupt이다', async () => {
    const doc = tripDoc();
    doc.labels = [{ id: '라벨', name: 'a'.repeat(393_217), color: 'red', order: 0 }];
    const d = await encode(doc);
    expect(d.length).toBeLessThanOrEqual(32_000);
    expect((await readShareHash(d)).ok).toBe(true);
    await expect(checkInboxDoc(d)).rejects.toMatchObject(invalid('corrupt'));
  });

  it.each([
    ['corrupt', 'corrupt'],
    ['newer', 'newer'],
    ['empty', 'corrupt'],
    ['too-many', 'too-many'],
  ] as const)('%s 문서의 최종 거절 사유는 %s다', async (reason, expectedReason) => {
    const doc = tripDoc();
    let d: string;
    if (reason === 'corrupt') d = '손상';
    else if (reason === 'newer') d = await encodeCompressedJson({ ...doc, version: 3 });
    // 장소 없이 Stop·후보가 남으면 원시 모양의 필요조건부터 어긴다.
    else if (reason === 'empty') d = await encode({ ...doc, places: [] });
    else {
      doc.places = Array.from({ length: 201 }, (_, i) => ({ ...doc.places[0]!, id: `p${i}` }));
      const trip = doc.trips[0]!;
      trip.originId = null;
      trip.candidateIds = doc.places.map((p) => p.id);
      trip.days = trip.days.map((day) => ({ ...day, lodgingId: null, stops: [], legs: [] }));
      trip.legModes = {};
      d = await encode(doc);
    }
    await expect(checkInboxDoc(d)).rejects.toMatchObject(invalid(expectedReason));
  });

  it('장소·Stop·후보가 모두 없는 문서는 empty로 거절한다', async () => {
    const doc = tripDoc();
    doc.places = [];
    const trip = doc.trips[0]!;
    trip.originId = null;
    trip.candidateIds = [];
    trip.days = trip.days.map((day) => ({ ...day, lodgingId: null, stops: [], legs: [] }));
    trip.legModes = {};
    await expect(checkInboxDoc(await encode(doc))).rejects.toMatchObject(invalid('empty'));
  });

  it('공유 문서 → 제목 → 장소 → 실제 구간 순서로 검사한다', async () => {
    const doc = tripDoc();
    doc.title = '가'.repeat(61);
    doc.places[0]!.name = '가'.repeat(101);
    doc.trips[0]!.legModes[`${doc.places[0]!.id}>${doc.places[0]!.id}`] = 'car';
    await expect(checkInboxDoc(await encode(doc))).rejects.toMatchObject(invalid('title'));
    doc.title = '정상';
    await expect(checkInboxDoc(await encode(doc))).rejects.toMatchObject(invalid('place-too-long'));
    doc.places[0]!.name = '정상';
    await expect(checkInboxDoc(await encode(doc))).rejects.toMatchObject(invalid('leg-modes'));
    await expect(
      checkInboxDoc(await encodeCompressedJson({ ...doc, version: 3 })),
    ).rejects.toMatchObject(invalid('newer'));
  });
});

describe('받은함 저장과 중복 요청', () => {
  it('정상 문서를 저장하고 201에 쓸 생성 결과와 30일 기한을 돌려준다', async () => {
    expect(INBOX_MAX_PENDING).toBe(20);
    expect(INBOX_TTL_MS).toBe(30 * DAY);
    const id = randomId();
    const checked = await checkInboxDoc(body.d);
    await expect(putInbox(db, principal, body, checked, id, NOW)).resolves.toEqual({
      id,
      expiresAt: NOW + 30 * DAY,
      created: true,
    });
    await expect(readInboxItem(db, principal.userId, id, NOW)).resolves.toEqual({
      id,
      data: body.d,
    });
    const rows = await listInbox(db, principal.userId, NOW);
    expect(JSON.stringify(rows).includes(secret)).toBe(false);
    expect(rows).toEqual([
      { id, ...meta, from: '여행 도우미', createdAt: NOW, expiresAt: NOW + 30 * DAY },
    ]);
  });

  it('같은 key는 데이터를 바꾸거나 기한을 연장하지 않는다', async () => {
    const first = await putInbox(db, principal, body, meta, randomId(), NOW);
    const changed = { ...body, d: await encode({ ...tripDoc(), title: '다른 문서' }) };
    await expect(putInbox(db, principal, changed, meta, randomId(), NOW + DAY)).resolves.toEqual({
      ...first,
      created: false,
    });
    await expect(readInboxItem(db, principal.userId, first.id, NOW)).resolves.toEqual({
      id: first.id,
      data: body.d,
    });
    expect(await listInbox(db, principal.userId, NOW)).toHaveLength(1);
  });

  it('20개 찬 뒤에도 같은 key는 기존 항목을 돌려주며 새 key는 409이다', async () => {
    const first = await putInbox(db, principal, body, meta, randomId(), NOW);
    await fill(19);
    await expect(putInbox(db, principal, body, meta, randomId(), NOW)).resolves.toEqual({
      ...first,
      created: false,
    });
    await expect(
      putInbox(db, principal, { ...body, key: randomKey() }, meta, randomId(), NOW),
    ).rejects.toMatchObject({ status: 409, code: 'inbox-full' });
    expect(await listInbox(db, principal.userId, NOW)).toHaveLength(20);
  });

  it.each([30, 31])('%i일 뒤 만료된 같은 key는 정리 전에도 새로 만든다', async (days) => {
    const first = await putInbox(db, principal, body, meta, randomId(), NOW);
    const now = NOW + days * DAY;
    const id = randomId();
    await expect(putInbox(db, principal, body, meta, id, now)).resolves.toEqual({
      id,
      expiresAt: now + 30 * DAY,
      created: true,
    });
    await expect(readInboxItem(db, principal.userId, first.id, NOW)).resolves.toBeNull();
    expect(await listInbox(db, principal.userId, now)).toHaveLength(1);
  });

  it('만료된 다른 key 20개는 한도에 세지 않는다', async () => {
    await fill(20);
    await expect(
      putInbox(db, principal, body, meta, randomId(), NOW + 31 * DAY),
    ).resolves.toMatchObject({ created: true });
  });

  it.each([0, 19])('%i개에서 같은 key 두 요청이 경쟁해도 같은 id가 된다', async (count) => {
    await fill(count);
    const results = await Promise.all([
      putInbox(db, principal, body, meta, randomId(), NOW),
      putInbox(db, principal, body, meta, randomId(), NOW),
    ]);
    expect(results[0]!.id).toBe(results[1]!.id);
    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(await listInbox(db, principal.userId, NOW)).toHaveLength(count + 1);
  });

  it('19개에서 다른 key 두 요청이 경쟁하면 하나만 들어가고 하나는 409이다', async () => {
    await fill(19);
    const results = await Promise.allSettled([
      putInbox(db, principal, body, meta, randomId(), NOW),
      putInbox(db, principal, { ...body, key: randomKey() }, meta, randomId(), NOW),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
      status: 409,
      code: 'inbox-full',
    });
    expect(await listInbox(db, principal.userId, NOW)).toHaveLength(20);
  });

  it('같은 key도 사용자마다 따로 저장한다', async () => {
    await putInbox(db, principal, body, meta, randomId(), NOW);
    const other = { ...principal, userId: '다른사용자' };
    await expect(putInbox(db, other, body, meta, randomId(), NOW)).resolves.toMatchObject({
      created: true,
    });
    expect(await listInbox(db, principal.userId, NOW)).toHaveLength(1);
    expect(await listInbox(db, other.userId, NOW)).toHaveLength(1);
  });

  it('UNIQUE 충돌 후 같은 key가 없으면 inbox-full이다', async () => {
    const id = randomId();
    await putInbox(db, principal, body, meta, id, NOW);
    await expect(
      putInbox(db, principal, { ...body, key: randomKey() }, meta, id, NOW),
    ).rejects.toMatchObject({ status: 409, code: 'inbox-full' });
  });

  it('UNIQUE 충돌이 아닌 저장 오류는 숨기지 않는다', async () => {
    const error = new Error('저장소 쓰기 실패');
    vi.spyOn(db, 'batch').mockRejectedValueOnce(error);
    await expect(putInbox(db, principal, body, meta, randomId(), NOW)).rejects.toBe(error);
  });
});

describe('받은함 목록과 읽기·삭제·정리', () => {
  it('만료 항목과 남의 항목을 빼고 생성 시각과 id 순으로 목록을 낸다', async () => {
    const insert = (id: string, now: number, userId = principal.userId) =>
      putInbox(db, { ...principal, userId }, { ...body, key: randomKey() }, meta, id, now);
    await insert('나중', NOW + 1);
    await insert('b', NOW);
    await insert('a', NOW);
    await insert('만료', NOW - 30 * DAY);
    await insert('남의항목', NOW, '다른사용자');
    const rows = await listInbox(db, principal.userId, NOW + 1);
    expect(rows.map((row) => row.id)).toEqual(['a', 'b', '나중']);
    expect(rows.every((row) => row.from === '여행 도우미')).toBe(true);
    expect(rows.every((row) => !('data' in row))).toBe(true);
    await db.prepare('DELETE FROM agent_tokens WHERE id = ?').bind(principal.tokenId).run();
    const withoutToken = await listInbox(db, principal.userId, NOW + 1);
    expect(withoutToken.map((row) => row.id)).toEqual(['a', 'b', '나중']);
    expect(withoutToken.every((row) => row.from === null)).toBe(true);
  });

  it('남의 항목과 없는 항목은 읽거나 지울 수 없다', async () => {
    const id = randomId();
    await putInbox(db, principal, body, meta, id, NOW);
    await expect(readInboxItem(db, '다른사용자', id, NOW)).resolves.toBeNull();
    await expect(deleteInboxItem(db, '다른사용자', id)).resolves.toBe(false);
    await expect(readInboxItem(db, principal.userId, '없는항목', NOW)).resolves.toBeNull();
    await expect(deleteInboxItem(db, principal.userId, '없는항목')).resolves.toBe(false);
    await expect(readInboxItem(db, principal.userId, id, NOW)).resolves.toEqual({
      id,
      data: body.d,
    });
    await expect(deleteInboxItem(db, principal.userId, id)).resolves.toBe(true);
    await expect(deleteInboxItem(db, principal.userId, id)).resolves.toBe(false);
    await expect(readInboxItem(db, principal.userId, id, NOW)).resolves.toBeNull();
  });

  it('만료 시각부터 목록과 읽기에서 숨기지만 본인 항목은 지울 수 있다', async () => {
    const id = randomId();
    const expiresAt = NOW + 30 * DAY;
    await putInbox(db, principal, body, meta, id, NOW);
    expect(await readInboxItem(db, principal.userId, id, expiresAt - 1)).not.toBeNull();
    expect(await listInbox(db, principal.userId, expiresAt - 1)).toHaveLength(1);
    await expect(readInboxItem(db, principal.userId, id, expiresAt)).resolves.toBeNull();
    await expect(listInbox(db, principal.userId, expiresAt)).resolves.toEqual([]);
    await expect(deleteInboxItem(db, principal.userId, id)).resolves.toBe(true);
  });

  it('전체 사용자의 만료 행을 오래된 순으로 최대 50개씩 지운다', async () => {
    expect(INBOX_PRUNE_MAX).toBe(50);
    await db.batch(
      Array.from({ length: 56 }, (_, i) =>
        db
          .prepare('INSERT INTO agent_inbox VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(
            `만료${String(i).padStart(2, '0')}`,
            i % 2 ? '다른사용자' : principal.userId,
            principal.tokenId,
            randomKey(),
            body.d,
            meta.title,
            meta.startDate,
            meta.endDate,
            meta.places,
            NOW - 31 * DAY,
            NOW - Math.floor(i / 2),
          ),
      ),
    );
    const id = randomId();
    await putInbox(db, principal, body, meta, id, NOW);
    await expect(pruneInbox(db, NOW)).resolves.toBe(50);
    const remaining = await db
      .prepare('SELECT id FROM agent_inbox WHERE expires_at <= ? ORDER BY expires_at, id')
      .bind(NOW)
      .all<{ id: string }>();
    expect(remaining.results.map((row) => row.id)).toEqual([
      '만료04',
      '만료05',
      '만료02',
      '만료03',
      '만료00',
      '만료01',
    ]);
    await expect(pruneInbox(db, NOW)).resolves.toBe(6);
    await expect(pruneInbox(db, NOW)).resolves.toBe(0);
    await expect(readInboxItem(db, principal.userId, id, NOW)).resolves.toEqual({
      id,
      data: body.d,
    });
  });

  it('오류 응답에는 무작위 토큰과 본문이 없다', async () => {
    let failure: unknown;
    try {
      parseInboxBody({ ...body, token: secret });
    } catch (error) {
      failure = error;
    }
    const response = syncError(failure);
    expect(response?.status).toBe(422);
    const output = await response!.text();
    expect(output.includes(secret)).toBe(false);
    expect(output.includes(body.d)).toBe(false);
    expect(JSON.parse(output)).toEqual({ error: 'invalid' });
  });
});
