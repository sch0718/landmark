import { afterEach, expect, it, vi } from 'vitest';
import {
  EMPTY_SERVER_BACKUP_LOCAL,
  readServerBackupLocal,
  writeServerBackupLocal,
  SERVER_BACKUP_KEY,
  SERVER_BACKUP_EVENT,
} from 'src/services/server-backup/storage';
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it.each([
  null,
  '{',
  '{"v":2}',
  JSON.stringify({
    v: 1,
    auto: true,
    userId: null,
    nextCheckAt: null,
    last: { at: 1, outcome: 'x' },
  }),
])('없거나 깨진 기록을 버린다: %s', (text) => {
  if (text !== null) localStorage.setItem(SERVER_BACKUP_KEY, text);
  expect(readServerBackupLocal(localStorage)).toEqual(EMPTY_SERVER_BACKUP_LOCAL);
});
it('기록을 왕복하고 이벤트를 보낸다', () => {
  const listener = vi.fn();
  window.addEventListener(SERVER_BACKUP_EVENT, listener);
  const state = {
    v: 1 as const,
    auto: true,
    userId: 'me',
    nextCheckAt: 500,
    last: { at: 1, outcome: 'uploaded' as const },
  };
  writeServerBackupLocal(localStorage, state);
  expect(readServerBackupLocal(localStorage)).toEqual(state);
  expect(listener).toHaveBeenCalledOnce();
  window.removeEventListener(SERVER_BACKUP_EVENT, listener);
});
it('저장소 읽기·쓰기 실패를 던지지 않는다', () => {
  const storage = {
    getItem() {
      throw Error();
    },
    setItem() {
      throw Error();
    },
  } as unknown as Storage;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(readServerBackupLocal(storage)).toEqual(EMPTY_SERVER_BACKUP_LOCAL);
  expect(() => writeServerBackupLocal(storage, EMPTY_SERVER_BACKUP_LOCAL)).not.toThrow();
});
