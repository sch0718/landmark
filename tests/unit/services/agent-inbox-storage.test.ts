import { beforeEach, expect, it, vi } from 'vitest';
import {
  AGENT_INBOX_KEY,
  readAgentInboxLocal,
  writeAgentInboxLocal,
} from 'src/services/agent-inbox/storage';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';

beforeEach(() => localStorage.clear());
const empty = (userId: string | null) => ({ v: 1, userId, notified: [] });

it('정해진 기기 키로 같은 사용자의 알림 기록을 읽고 써요', () => {
  expect(AGENT_INBOX_KEY).toBe('tripmap:agent-inbox:v1');
  expect(readAgentInboxLocal(localStorage, 'account-a')).toEqual(empty('account-a'));
  const value = { v: 1 as const, userId: 'account-a', notified: ['one', 'two'] };
  writeAgentInboxLocal(localStorage, value);
  expect(JSON.parse(localStorage.getItem(AGENT_INBOX_KEY)!)).toEqual(value);
  expect(readAgentInboxLocal(localStorage, 'account-a')).toEqual(value);
  expect(localStorage.length).toBe(1);
});

it('다른 사용자나 로그인 상태가 바뀌면 빈 기록을 돌려줘요', () => {
  writeAgentInboxLocal(localStorage, { v: 1, userId: 'account-a', notified: ['one'] });
  expect(readAgentInboxLocal(localStorage, 'account-b')).toEqual(empty('account-b'));
  expect(readAgentInboxLocal(localStorage, null)).toEqual(empty(null));
  writeAgentInboxLocal(localStorage, { v: 1, userId: null, notified: ['anonymous'] });
  expect(readAgentInboxLocal(localStorage, null).notified).toEqual(['anonymous']);
  expect(readAgentInboxLocal(localStorage, 'account-a')).toEqual(empty('account-a'));
});

it.each([
  '{',
  'null',
  '[]',
  '{}',
  '{"v":2,"userId":"account-a","notified":[]}',
  '{"v":1,"notified":[]}',
  '{"v":1,"userId":7,"notified":[]}',
  '{"v":1,"userId":"account-a","notified":"one"}',
])('깨진 기록을 빈 기록으로 읽어요: %s', (raw) => {
  localStorage.setItem(AGENT_INBOX_KEY, raw);
  expect(readAgentInboxLocal(localStorage, 'account-a')).toEqual(empty('account-a'));
});

it('읽을 때 문자열만 남기고 뒤쪽 100개를 유지해요', () => {
  const notified = Array.from({ length: 105 }, (_, i) => String(i));
  localStorage.setItem(
    AGENT_INBOX_KEY,
    JSON.stringify({ v: 1, userId: 'account-a', notified: [null, ...notified, 7, {}] }),
  );
  expect(readAgentInboxLocal(localStorage, 'account-a').notified).toEqual(notified.slice(-100));
});

it('쓸 때 뒤쪽 100개를 유지하고 원본 배열은 바꾸지 않아요', () => {
  const notified = Array.from({ length: 105 }, (_, i) => String(i));
  writeAgentInboxLocal(localStorage, { v: 1, userId: 'account-a', notified });
  expect(JSON.parse(localStorage.getItem(AGENT_INBOX_KEY)!).notified).toEqual(notified.slice(-100));
  expect(notified).toHaveLength(105);
});

it('읽기가 차단되면 빈 기록을 돌려줘요', () => {
  const storage = createMemoryStorage();
  vi.spyOn(storage, 'getItem').mockImplementation(() => {
    throw new Error('저장소 차단');
  });
  expect(readAgentInboxLocal(storage, 'account-a')).toEqual(empty('account-a'));
});

it('쓰기가 차단돼도 오류를 내보내지 않아요', () => {
  const storage = createMemoryStorage();
  vi.spyOn(storage, 'setItem').mockImplementation(() => {
    throw new Error('저장소 차단');
  });
  expect(() =>
    writeAgentInboxLocal(storage, { v: 1, userId: 'account-a', notified: ['one'] }),
  ).not.toThrow();
});
