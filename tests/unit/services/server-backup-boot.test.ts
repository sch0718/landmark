import { afterEach, expect, it } from 'vitest';
import { readAutoBackupFlag } from 'src/services/server-backup/boot';
afterEach(() => localStorage.clear());
it('동기화와 자동 백업이 모두 켜졌을 때만 실행기를 받는다', () => {
  localStorage.setItem(
    'tripmap:server-backup:v1',
    JSON.stringify({ v: 1, auto: true, userId: null, nextCheckAt: null, last: null }),
  );
  expect(readAutoBackupFlag()).toBe(false);
  localStorage.setItem('tripmap:sync:v1', '{"enabled":true}');
  expect(readAutoBackupFlag()).toBe(true);
  expect(
    readAutoBackupFlag({
      getItem() {
        throw Error();
      },
    } as unknown as Storage),
  ).toBe(false);
});
