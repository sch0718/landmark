import { beforeEach, expect, it, vi } from 'vitest';
import {
  readSyncMeta,
  clearSyncRecords,
  writeSyncMeta,
  readBase,
  writeBase,
  encodeBaseEntry,
  decodeBaseEntry,
  readConflicts,
  writeConflicts,
  readSession,
  writeSession,
  SyncStorageError,
  SYNC_META_KEY,
  SYNC_BASE_KEY,
  SYNC_SESSION_KEY,
} from 'src/services/library-sync/storage';
beforeEach(() => localStorage.clear());
it('깨진 기록은 꺼진 새 기기로 읽고 deviceId는 16자다', () => {
  expect(readSyncMeta(localStorage)).toMatchObject({
    enabled: false,
    pendingChoice: false,
    cursor: null,
  });
  expect(readSyncMeta(localStorage).deviceId).toMatch(/^[a-z0-9]{16}$/);
  for (const text of ['{', '{}', '{"v":1,"enabled":true}']) {
    localStorage.setItem(SYNC_META_KEY, text);
    expect(readSyncMeta(localStorage).enabled).toBe(false);
  }
});
it('base 왕복과 잘못된 항목 버리기', () => {
  for (const deleted of [false, true]) {
    const e = { rev: 321, hash: 'abc123', deleted };
    expect(decodeBaseEntry(encodeBaseEntry(e))).toEqual(e);
  }
  expect(decodeBaseEntry('bad')).toBeNull();
  writeBase(localStorage, 'u', { 'place:place00001': { rev: 1, hash: 'abc', deleted: false } });
  expect(readBase(localStorage).userId).toBe('u');
  localStorage.setItem(
    SYNC_BASE_KEY,
    JSON.stringify({
      v: 1,
      userId: 'u',
      items: { 'place:place00001': '1.abc', 'place:bad': 'bad' },
    }),
  );
  expect(Object.keys(readBase(localStorage).items)).toEqual(['place:place00001']);
});
it('충돌은 최신 50건과 20만 자만 남긴다', () => {
  const items = Array.from({ length: 60 }, (_, i) => ({
    id: String(i),
    key: 'place:place00001' as const,
    kind: 'place' as const,
    label: '장소',
    path: 'memo',
    mine: 'x'.repeat(5000),
    theirs: '값',
    at: new Date(i).toISOString(),
  }));
  writeConflicts(localStorage, items);
  const read = readConflicts(localStorage);
  expect(read.length).toBeLessThanOrEqual(50);
  expect(JSON.stringify({ v: 1, items: read }).length).toBeLessThanOrEqual(200000);
  expect(read.at(-1)?.id).toBe('59');
});
it('세션 형식과 저장 실패를 검사한다', () => {
  localStorage.setItem(SYNC_SESSION_KEY, '{"v":1,"provider":"kakao","sessionId":"bad"}');
  expect(readSession(localStorage)).toBeNull();
  writeSession(localStorage, { v: 1, provider: 'kakao', sessionId: 'a'.repeat(43) });
  expect(readSession(localStorage)?.provider).toBe('kakao');
  const bad = {
    setItem: vi.fn(() => {
      throw Error('막힘');
    }),
  } as unknown as Storage;
  expect(() => writeSyncMeta(bad, readSyncMeta(localStorage))).toThrow(SyncStorageError);
});

it('옛 meta는 건너뛴 시각 없이 읽고 lastSyncAt을 그대로 보존한다', () => {
  const meta = {
    ...readSyncMeta(localStorage),
    enabled: true,
    lastSyncAt: '2026-10-30T00:00:00.000Z',
    skipped: ['place:place00001'],
  };
  const { skippedAt: _skippedAt, ...old } = meta;
  void _skippedAt;
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(old));
  expect(readSyncMeta(localStorage)).toEqual({ ...old, skippedAt: {} });
});
it('건너뛴 시각은 왕복하고 동기화 기록을 비우면 함께 지운다', () => {
  const skippedAt = { 'place:place00001': '2026-10-30T00:00:00.000Z' };
  writeSyncMeta(localStorage, { ...readSyncMeta(localStorage), skippedAt });
  expect(readSyncMeta(localStorage).skippedAt).toEqual(skippedAt);
  clearSyncRecords(localStorage);
  expect(readSyncMeta(localStorage).skippedAt).toEqual({});
});
it.each(
  [null, [], 'bad', { 'bad:key': '2026-10-30' }, { 'place:place00001': 1 }].map((skippedAt) => ({
    skippedAt,
  })),
)('깨진 skippedAt $skippedAt는 기존 meta 검사처럼 꺼진 새 기기로 읽는다', ({ skippedAt }) => {
  localStorage.setItem(
    SYNC_META_KEY,
    JSON.stringify({ ...readSyncMeta(localStorage), enabled: true, skippedAt }),
  );
  expect(readSyncMeta(localStorage)).toMatchObject({ enabled: false, skippedAt: {} });
});
