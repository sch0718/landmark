import { expect, it, vi } from 'vitest';
import { createBackupApi, toBackupFailure, uploadBody } from 'src/services/server-backup/api';
import type { SyncApi } from 'src/services/library-sync/api';
it.each([
  [{ kind: 'auth' }, 'auth'],
  [{ kind: 'not-allowed' }, 'not-allowed'],
  [{ kind: 'offline' }, 'offline'],
  [{ kind: 'off' }, 'off'],
  [{ kind: 'busy' }, 'changed'],
  [{ kind: 'limit', code: 'off' }, 'off'],
  [{ kind: 'limit' }, 'limit'],
  [{ kind: 'invalid', code: 'too-large' }, 'too-large'],
  [{ kind: 'invalid' }, 'invalid'],
  [{ kind: 'not-found' }, 'not-found'],
  [{ kind: 'server', status: 409 }, 'changed'],
  [{ kind: 'server', status: 500 }, 'server'],
  [{ kind: 'resync' }, 'server'],
])('실패를 해석한다: %j', (fail, expected) => {
  expect(toBackupFailure(fail as { kind: string })).toBe(expected);
});
it('경로·메서드·본문과 삭제 성공을 변환한다', async () => {
  const send = vi.fn().mockResolvedValue({ ok: true, data: {} });
  const api = createBackupApi({ client: { send } } as unknown as Pick<SyncApi, 'client'>);
  await api.meta();
  expect(send).toHaveBeenLastCalledWith('GET', '/v1/backup');
  const s = {
    data: 'H4sI',
    storedBytes: 3,
    rawBytes: 10,
    contentHash: 'abc',
    counts: { places: 1, labels: 0, trips: 0, meetings: 0 },
    exportedAt: '2026-10-29T00:00:00Z',
  };
  const body = uploadBody(s, { deviceId: 'abcdefgh12345678', deviceLabel: '시험' }, 'manual');
  expect(body).not.toHaveProperty('ifMatch');
  expect(
    uploadBody(s, { deviceId: 'abcdefgh12345678', deviceLabel: '시험' }, 'auto', null),
  ).toHaveProperty('ifMatch', null);
  await api.upload(body);
  expect(send).toHaveBeenLastCalledWith('POST', '/v1/backup', { body });
  await api.download('a b');
  expect(send).toHaveBeenLastCalledWith('GET', '/v1/backup/data?id=a%20b');
  expect(await api.remove()).toEqual({ ok: true, data: null });
  send.mockResolvedValue({ ok: false, kind: 'busy' });
  expect(await api.meta()).toEqual({ ok: false, reason: 'changed' });
});
