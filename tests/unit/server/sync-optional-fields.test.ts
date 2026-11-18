// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestD1 } from '@sch0718/firebase-session/testing/d1';
import { ensureSchema } from 'src/server/meet/db';
import { pushItems } from 'src/server/library-sync/library';
import type { SyncUser } from 'src/server/library-sync/auth';
import type { Trip } from 'src/schema/trip';

// v0.36 앱은 legTransit·legMinutes를 모른다. 받은 여행을 스키마로 읽으며 두 키를 떼고,
// 다른 필드를 고친 뒤 같은 rev를 base로 올린다.
const now = Date.parse('2026-11-18T00:00:00.000Z');
const t0 = '2026-11-10T00:00:00.000Z';
const t1 = '2026-11-11T00:00:00.000Z';
const t2 = '2026-11-12T00:00:00.000Z';
const f = <T>(value: T, updatedAt = t0) => ({ value, updatedAt });
const LEG = 'place00001>place00002';
const trip = (): Trip => ({
  id: 'trip000001',
  title: f('이베리아'),
  startDate: f('2026-12-01'),
  endDate: f('2026-12-01'),
  origin: f(null),
  candidates: f([]),
  days: [
    {
      stops: f([
        { id: 'stop0001', placeId: 'place00001', stayMin: null, fixedTime: null, note: '' },
        { id: 'stop0002', placeId: 'place00002', stayMin: null, fixedTime: null, note: '' },
      ]),
      lodging: f(null),
      startTime: f('09:00'),
    },
  ],
  legModes: f({}),
  legTransit: f([LEG], t1),
  legMinutes: f({ [LEG]: 50 }, t1),
  createdAt: t0,
  deletedAt: null,
});
const user: SyncUser = {
  userId: 'user-a',
  sessionHash: 'hash-a',
  sessionId: 'session-a',
  provider: 'kakao',
  account: 'kakao:dev-me',
};
const push = (doc: Trip, baseRev: number) =>
  pushItems(
    db,
    user,
    {
      v: 1,
      deviceId: 'a'.repeat(16),
      items: [{ kind: 'trip', id: doc.id, baseRev, baseDeleted: false, doc }],
    },
    now,
  );
const stored = async () =>
  JSON.parse(
    (await db.prepare('SELECT doc FROM library_items').first<{ doc: string }>())!.doc,
  ) as Trip;
const oldClient = (doc: Trip): Trip => {
  const rest = { ...doc, title: f('이베리아 여행', t2) };
  delete rest.legTransit;
  delete rest.legMinutes;
  return rest;
};

let db: ReturnType<typeof createTestD1>;
beforeEach(async () => {
  db = createTestD1();
  await ensureSchema(db);
});
afterEach(() => db.close());

it('옛 클라이언트가 선택 필드 없이 올려도 저장된 값이 남는다', async () => {
  const first = await push(trip(), 0);
  const reply = await push(oldClient(trip()), first.rev);
  const doc = await stored();
  expect(doc.title.value).toBe('이베리아 여행');
  expect(doc.legTransit).toEqual(f([LEG], t1));
  expect(doc.legMinutes).toEqual(f({ [LEG]: 50 }, t1));
  expect(reply.results[0]?.doc).toMatchObject({ legTransit: f([LEG], t1) });
});

it('새 클라이언트에서 지운 선택 필드는 지워진다', async () => {
  const first = await push(trip(), 0);
  await push({ ...trip(), legTransit: f([], t2), legMinutes: f({}, t2) }, first.rev);
  const doc = await stored();
  expect(doc.legTransit).toEqual(f([], t2));
  expect(doc.legMinutes).toEqual(f({}, t2));
});
