import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import {
  allOnline,
  createOnlineStore,
  isLinkMeeting,
  MEET_ONLINE_KEY,
  readOnline,
  removeOnline,
  writeOnline,
} from 'src/services/meet-online/store';
import { buildMeeting } from '../../fixtures/builders';
import { docFromMeeting } from 'src/domain/meeting/online-doc';

it('주최자 버전이 없는 참석자 전용 기록을 새 저장소에서도 복원한다', () => {
  const storage = createMemoryStorage();
  const record = { guest: { participantId: 'person02', token: 'guest' } };
  storage.setItem(MEET_ONLINE_KEY, JSON.stringify({ meeting001: record }));
  expect(createOnlineStore(() => storage).readOnline('meeting001')).toEqual(record);
});

it.each([null, -1, 1.5, '3'])(
  '참석자 기록에 깨진 주최자 lastRev %j가 있으면 그 기록만 버린다',
  (lastRev) => {
    const storage = createMemoryStorage();
    const guest = { participantId: 'person02', token: 'guest' };
    storage.setItem(
      MEET_ONLINE_KEY,
      JSON.stringify({
        meeting001: { guest, lastRev },
        meeting002: { guest },
      }),
    );
    expect(createOnlineStore(() => storage).allOnline()).toEqual({ meeting002: { guest } });
  },
);

it('마지막으로 맞춘 본문을 새 저장소에서도 복원한다', () => {
  const storage = createMemoryStorage();
  const record = { lastRev: 1, syncedDoc: docFromMeeting(buildMeeting(), {}, 'min') };
  createOnlineStore(() => storage).writeOnline('meeting001', record);
  expect(createOnlineStore(() => storage).readOnline('meeting001')).toEqual(record);
});

it.each([null, {}, { title: '깨짐' }])('깨진 syncedDoc %j의 기록만 버린다', (syncedDoc) => {
  const storage = createMemoryStorage();
  storage.setItem(
    MEET_ONLINE_KEY,
    JSON.stringify({
      meeting001: { lastRev: 1, syncedDoc },
      meeting002: { lastRev: 1 },
    }),
  );
  expect(createOnlineStore(() => storage).allOnline()).toEqual({ meeting002: { lastRev: 1 } });
});

it('64KB를 넘는 동기화 본문 기록은 읽지 않는다', () => {
  const storage = createMemoryStorage();
  const syncedDoc = { ...docFromMeeting(buildMeeting(), {}, 'min'), title: '가'.repeat(22_000) };
  storage.setItem(MEET_ONLINE_KEY, JSON.stringify({ meeting001: { lastRev: 1, syncedDoc } }));
  expect(createOnlineStore(() => storage).readOnline('meeting001')).toBeNull();
});

beforeEach(() => localStorage.removeItem(MEET_ONLINE_KEY));

describe('온라인 약속 연결 기록', () => {
  it('주최자·참석자·버전·동기화·종료 기록을 왕복하고 지운다', () => {
    const record = {
      seen: ['person03'],
      hostToken: 'host',
      pendingHostToken: 'p'.repeat(43),
      hostLikes: ['choice01'],
      hostLikesAckRev: 8,
      guest: { participantId: 'person02', token: 'guest' },
      lastRev: 7,
      docRev: 3,
      syncedDoc: docFromMeeting(buildMeeting(), {}, 'min'),
      ended: true as const,
    };
    expect(readOnline('meeting001')).toBeNull();
    writeOnline('meeting001', record);
    expect(readOnline('meeting001')).toEqual(record);
    expect(allOnline()).toEqual({ meeting001: record });
    expect(JSON.parse(localStorage.getItem(MEET_ONLINE_KEY)!)).toEqual(allOnline());
    removeOnline('meeting001');
    expect(readOnline('meeting001')).toBeNull();
  });

  it.each(['broken', 'null', '[]', '1', '{"meeting001":{"lastRev":"1"}}'])(
    '깨진 기록 %s는 빈 기록으로 읽고 다음 쓰기를 저장한다',
    (raw) => {
      const storage = createMemoryStorage();
      storage.setItem(MEET_ONLINE_KEY, raw);
      const store = createOnlineStore(() => storage);
      expect(store.allOnline()).toEqual({});
      store.writeOnline('meeting002', { lastRev: 0 });
      expect(createOnlineStore(() => storage).readOnline('meeting002')).toEqual({ lastRev: 0 });
    },
  );

  it('깨진 항목만 버리고 정상 항목은 남긴다', () => {
    const storage = createMemoryStorage();
    storage.setItem(
      MEET_ONLINE_KEY,
      JSON.stringify({
        meeting001: { lastRev: 1 },
        meeting002: { lastRev: -1 },
        meeting003: { lastRev: 1, guest: { token: 7 } },
        meeting004: { lastRev: 1, ended: false },
      }),
    );
    expect(createOnlineStore(() => storage).allOnline()).toEqual({ meeting001: { lastRev: 1 } });
  });

  it('저장소 접근이 막히면 메모리에서 쓰고 지운다', () => {
    const store = createOnlineStore(() => {
      throw new Error('차단');
    });
    expect(store.allOnline()).toEqual({});
    store.writeOnline('meeting001', { lastRev: 1 });
    expect(store.readOnline('meeting001')).toEqual({ lastRev: 1 });
    store.removeOnline('meeting001');
    expect(store.allOnline()).toEqual({});
  });

  it('쓰기 실패 뒤에는 기존 값과 새 값을 메모리에 보존한다', () => {
    const storage = createMemoryStorage();
    storage.setItem(MEET_ONLINE_KEY, '{"meeting001":{"lastRev":1}}');
    const store = createOnlineStore(() => storage);
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('용량');
    });
    store.writeOnline('meeting002', { lastRev: 2 });
    expect(store.allOnline()).toEqual({ meeting001: { lastRev: 1 }, meeting002: { lastRev: 2 } });
    store.removeOnline('meeting001');
    expect(store.allOnline()).toEqual({ meeting002: { lastRev: 2 } });
  });

  it('최근에 다시 쓴 기록을 남기고 오래된 기록부터 200개로 줄인다', () => {
    const storage = createMemoryStorage();
    const store = createOnlineStore(() => storage);
    for (let i = 0; i < 200; i++)
      store.writeOnline(`m${String(i).padStart(9, '0')}`, { lastRev: i });
    store.writeOnline('m000000000', { lastRev: 201 });
    store.writeOnline('m000000200', { lastRev: 1 });
    expect(Object.keys(store.allOnline())).toHaveLength(200);
    expect(store.readOnline('m000000001')).toBeNull();
    expect(store.readOnline('m000000000')).toEqual({ lastRev: 201 });
    expect(Object.keys(createOnlineStore(() => storage).allOnline())).toHaveLength(200);
  });

  it('이미 200개를 넘긴 저장 값도 최근 기록만 읽는다', () => {
    const storage = createMemoryStorage();
    storage.setItem(
      MEET_ONLINE_KEY,
      JSON.stringify(
        Object.fromEntries(
          Array.from({ length: 201 }, (_, i) => [`m${String(i).padStart(9, '0')}`, { lastRev: i }]),
        ),
      ),
    );
    const store = createOnlineStore(() => storage);
    expect(Object.keys(store.allOnline())).toHaveLength(200);
    expect(store.readOnline('m000000000')).toBeNull();
  });

  it.each([
    { hostToken: 'host' },
    { guest: { participantId: 'person02', token: 'guest' } },
    { pendingHostToken: 'p'.repeat(43) },
    { pendingGuest: { participantId: 'person02', token: 'g'.repeat(43) } },
  ])('토큰 기록 %j는 남기고 오래된 토큰 없는 기록부터 정리한다', (token) => {
    const storage = createMemoryStorage();
    const store = createOnlineStore(() => storage);
    const record = { ...token, lastRev: 1 };
    store.writeOnline('meeting001', record);
    for (let i = 0; i < 250; i++)
      store.writeOnline(`m${String(i).padStart(9, '0')}`, { lastRev: i });
    expect(store.readOnline('meeting001')).toEqual(record);
    expect(Object.keys(store.allOnline())).toHaveLength(200);
    expect(store.readOnline('m000000050')).toBeNull();
    expect(store.readOnline('m000000051')).toEqual({ lastRev: 51 });
    expect(createOnlineStore(() => storage).readOnline('meeting001')).toEqual(record);
  });

  it('살아 있는 토큰 기록만 200개를 넘어도 모두 보존하고 끝난 기록만 지운다', () => {
    const storage = createMemoryStorage();
    const store = createOnlineStore(() => storage);
    store.writeOnline('meeting001', { hostToken: 'ended', lastRev: 1, ended: true });
    for (let i = 0; i < 201; i++)
      store.writeOnline(`m${String(i).padStart(9, '0')}`, { hostToken: 'host', lastRev: i });
    expect(store.readOnline('meeting001')).toBeNull();
    expect(Object.keys(store.allOnline())).toHaveLength(201);
    expect(Object.keys(createOnlineStore(() => storage).allOnline())).toHaveLength(201);
  });

  it.each([
    [null, {}, false],
    [null, { person01: { likes: [], sentAt: '', receivedAt: '' } }, false],
    [null, { person02: { likes: [], sentAt: '', receivedAt: '' } }, true],
    [
      { hostToken: 'host', lastRev: 1 },
      { person02: { likes: [], sentAt: '', receivedAt: '' } },
      false,
    ],
  ] as const)(
    '주최자 연결과 다른 참석자 답장으로 링크 방식을 판단한다 (%j, %j)',
    (record, replies, expected) => {
      const meeting = buildMeeting();
      expect(
        isLinkMeeting({ ...meeting, replies: { ...meeting.replies, value: replies } }, record),
      ).toBe(expected);
    },
  );
});

it.each([
  null,
  'person03',
  ['bad'],
  Array.from({ length: 11 }, (_, i) => `person${String(i).padStart(2, '0')}`),
])('깨진 seen 값 %j가 있는 기록만 버린다', (seen) => {
  const storage = createMemoryStorage();
  storage.setItem(
    MEET_ONLINE_KEY,
    JSON.stringify({
      meeting001: { lastRev: 1, seen },
      meeting002: { lastRev: 1 },
    }),
  );
  expect(createOnlineStore(() => storage).allOnline()).toEqual({ meeting002: { lastRev: 1 } });
});

it('대기 중인 최초 본문을 새 저장소에서도 복원한다', () => {
  const storage = createMemoryStorage();
  const record = {
    lastRev: 0,
    pendingHostToken: 'p'.repeat(43),
    syncedDoc: docFromMeeting(buildMeeting(), {}, 'min'),
  };
  createOnlineStore(() => storage).writeOnline('meeting001', record);
  expect(createOnlineStore(() => storage).readOnline('meeting001')).toEqual(record);
});

it('구독한 약속의 같은 탭 쓰기와 삭제만 알리고 해제 뒤에는 멈춘다', () => {
  const storage = createMemoryStorage();
  const store = createOnlineStore(() => storage);
  const listener = vi.fn();
  const unsubscribe = store.subscribeOnline('meeting001', listener);
  store.writeOnline('meeting002', { lastRev: 1 });
  expect(listener).not.toHaveBeenCalled();
  store.writeOnline('meeting001', { lastRev: 2, ended: true });
  expect(listener).toHaveBeenLastCalledWith({ lastRev: 2, ended: true });
  store.removeOnline('meeting001');
  expect(listener).toHaveBeenLastCalledWith(null);
  unsubscribe();
  store.writeOnline('meeting001', { lastRev: 3 });
  expect(listener).toHaveBeenCalledTimes(2);
});

it('storage 이벤트는 구독한 약속을 다시 읽고 다른 키와 해제된 구독은 무시한다', () => {
  const storage = createMemoryStorage();
  const store = createOnlineStore(() => storage);
  const listener = vi.fn();
  const unsubscribe = store.subscribeOnline('meeting001', listener);
  storage.setItem(MEET_ONLINE_KEY, JSON.stringify({ meeting001: { lastRev: 2, ended: true } }));
  window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
  expect(listener).not.toHaveBeenCalled();
  window.dispatchEvent(new StorageEvent('storage', { key: MEET_ONLINE_KEY, newValue: '{}' }));
  expect(listener).toHaveBeenCalledExactlyOnceWith({ lastRev: 2, ended: true });
  unsubscribe();
  window.dispatchEvent(new StorageEvent('storage', { key: MEET_ONLINE_KEY }));
  expect(listener).toHaveBeenCalledTimes(1);
});

it('저장소가 막혀도 같은 탭의 메모리 기록 변경을 알린다', () => {
  const store = createOnlineStore(() => {
    throw new Error('차단');
  });
  const listener = vi.fn();
  const unsubscribe = store.subscribeOnline('meeting001', listener);
  store.writeOnline('meeting001', { lastRev: 1 });
  expect(listener).toHaveBeenCalledExactlyOnceWith({ lastRev: 1 });
  unsubscribe();
});

it.each([false, true])(
  '전체 기록 구독은 쓰기·삭제를 알리고 해제한다 (메모리 전용: %s)',
  (blocked) => {
    const storage = createMemoryStorage();
    const store = createOnlineStore(() => {
      if (blocked) throw new Error('차단');
      return storage;
    });
    const listener = vi.fn();
    const unsubscribe = store.subscribeAllOnline(listener);
    store.writeOnline('meeting001', { hostToken: 'host' });
    expect(listener).toHaveBeenCalledTimes(1);
    store.writeOnline('meeting002', { ended: true });
    expect(listener).toHaveBeenCalledTimes(2);
    store.removeOnline('meeting001');
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    store.writeOnline('meeting001', { lastRev: 1 });
    expect(listener).toHaveBeenCalledTimes(3);
  },
);

it('전체 기록 구독은 다른 키를 무시하고 storage 변경·전체 삭제만 알린다', () => {
  const store = createOnlineStore(() => createMemoryStorage());
  const listener = vi.fn();
  const unsubscribe = store.subscribeAllOnline(listener);
  window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
  expect(listener).not.toHaveBeenCalled();
  window.dispatchEvent(new StorageEvent('storage', { key: MEET_ONLINE_KEY }));
  expect(listener).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new StorageEvent('storage', { key: null }));
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
  window.dispatchEvent(new StorageEvent('storage', { key: MEET_ONLINE_KEY }));
  expect(listener).toHaveBeenCalledTimes(2);
});

it('답장 출발지 10개를 새 저장소에서도 복원한다', () => {
  const storage = createMemoryStorage();
  const replyOrigins = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [
      `person${String(i).padStart(2, '0')}`,
      { name: '집', lng: 127, lat: 37.5 },
    ]),
  );
  const record = { hostToken: 'host', replyOrigins };
  createOnlineStore(() => storage).writeOnline('meeting001', record);
  expect(createOnlineStore(() => storage).readOnline('meeting001')).toEqual(record);
});

it.each([
  null,
  [],
  { bad: { name: '집', lng: 127, lat: 37.5 } },
  { person01: null },
  { person01: { name: '집', lng: 0, lat: 37.5 } },
  Object.fromEntries(
    Array.from({ length: 11 }, (_, i) => [
      `person${String(i).padStart(2, '0')}`,
      { name: '집', lng: 127, lat: 37.5 },
    ]),
  ),
])('깨진 replyOrigins 값 %j가 있는 기록만 버린다', (replyOrigins) => {
  const storage = createMemoryStorage();
  storage.setItem(
    MEET_ONLINE_KEY,
    JSON.stringify({
      meeting001: { hostToken: 'host', replyOrigins },
      meeting002: { lastRev: 1 },
    }),
  );
  expect(createOnlineStore(() => storage).allOnline()).toEqual({ meeting002: { lastRev: 1 } });
});

it('답장 전용 참석자의 기준 이름을 seen과 함께 복원한다', () => {
  const storage = createMemoryStorage();
  const record = { seen: ['person03'], seenNames: { person03: '친구' } };
  createOnlineStore(() => storage).writeOnline('meeting001', record);
  expect(createOnlineStore(() => storage).readOnline('meeting001')).toEqual(record);
});

it.each([
  null,
  [],
  { bad: '친구' },
  { person03: '' },
  { person03: 3 },
  { person03: '가'.repeat(21) },
  Object.fromEntries(
    Array.from({ length: 11 }, (_, i) => [`person${String(i).padStart(2, '0')}`, '친구']),
  ),
])('깨진 seenNames %j의 기록만 버린다', (seenNames) => {
  const storage = createMemoryStorage();
  storage.setItem(
    MEET_ONLINE_KEY,
    JSON.stringify({ meeting001: { seenNames }, meeting002: { lastRev: 1 } }),
  );
  expect(createOnlineStore(() => storage).allOnline()).toEqual({ meeting002: { lastRev: 1 } });
});

it.each([
  { participantId: 'person02', token: 'g'.repeat(43) },
  { newName: '새 친구', token: 'g'.repeat(43) },
])('고르기 대기 기록 %j를 복원한다', (pendingGuest) => {
  const storage = createMemoryStorage();
  const record = { pendingGuest };
  createOnlineStore(() => storage).writeOnline('meeting001', record);
  expect(createOnlineStore(() => storage).readOnline('meeting001')).toEqual(record);
});

it.each([
  null,
  {},
  { token: 'g'.repeat(43) },
  { participantId: 'bad', token: 'g'.repeat(43) },
  { participantId: 'person02', token: 'short' },
  { newName: '', token: 'g'.repeat(43) },
  { newName: '가'.repeat(21), token: 'g'.repeat(43) },
  { participantId: 'person02', newName: '친구', token: 'g'.repeat(43) },
])('깨진 pendingGuest %j의 기록만 버린다', (pendingGuest) => {
  const storage = createMemoryStorage();
  storage.setItem(
    MEET_ONLINE_KEY,
    JSON.stringify({ meeting001: { pendingGuest }, meeting002: { lastRev: 1 } }),
  );
  expect(createOnlineStore(() => storage).allOnline()).toEqual({ meeting002: { lastRev: 1 } });
});

it('updateOnline은 최신 기록을 읽어 조건이 맞을 때만 쓰고 같은 탭 구독의 후속 변경도 지킨다', async () => {
  // 두 탭이 같은 저장소를 공유한다.
  const storage = createMemoryStorage();
  const first = createOnlineStore(() => storage);
  const second = createOnlineStore(() => storage);
  expect(first).toHaveProperty('updateOnline', expect.any(Function));
  const update = first.updateOnline;
  first.writeOnline('meeting001', { hostToken: 'old' });
  second.writeOnline('meeting001', { hostToken: 'new', pendingHostToken: 'p'.repeat(43) });
  const listener = vi.fn();
  const unsubscribe = first.subscribeOnline('meeting001', listener);
  update('meeting001', (current) =>
    current?.hostToken === 'old' ? { ...current, hostToken: 'stale' } : current,
  );
  expect(first.readOnline('meeting001')?.hostToken).toBe('new');
  expect(listener).not.toHaveBeenCalled();
  update('meeting001', (current) => ({ ...current, lastRev: 2 }));
  expect(second.readOnline('meeting001')).toEqual({
    hostToken: 'new',
    pendingHostToken: 'p'.repeat(43),
    lastRev: 2,
  });
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
});

it('updateOnline의 구독자가 같은 탭에서 이어 쓴 결과를 돌려주고 보존한다', () => {
  const storage = createMemoryStorage();
  const store = createOnlineStore(() => storage);
  store.writeOnline('meeting001', { hostToken: 'old' });
  const unsubscribe = store.subscribeOnline('meeting001', () => {
    unsubscribe();
    store.updateOnline('meeting001', (current) => ({
      ...current,
      pendingHostToken: 'p'.repeat(43),
    }));
  });
  expect(store.updateOnline('meeting001', (current) => ({ ...current, hostToken: 'new' }))).toEqual(
    { hostToken: 'new', pendingHostToken: 'p'.repeat(43) },
  );
  expect(store.readOnline('meeting001')).toEqual({
    hostToken: 'new',
    pendingHostToken: 'p'.repeat(43),
  });
});
