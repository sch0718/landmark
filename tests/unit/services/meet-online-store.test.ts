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

beforeEach(() => localStorage.removeItem(MEET_ONLINE_KEY));

describe('온라인 약속 연결 기록', () => {
  it('주최자·참석자·버전·동기화·종료 기록을 왕복하고 지운다', () => {
    const record = {
      hostToken: 'host',
      guest: { participantId: 'person02', token: 'guest' },
      lastRev: 7,
      docRev: 3,
      syncedAt: '2026-10-26T00:00:00.000Z',
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
