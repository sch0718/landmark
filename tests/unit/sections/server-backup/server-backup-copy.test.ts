import { expect, it } from 'vitest';
import {
  metaLine,
  restoreHeader,
  failureText,
  autoOutcomeText,
  overwriteConfirmText,
} from 'src/sections/server-backup/server-backup-copy';
import type { ServerBackupMeta } from 'src/services/server-backup/api';
const meta: ServerBackupMeta = {
  id: '0123456789abcdef',
  createdAt: Date.parse('2026-10-29T01:00:00Z'),
  exportedAt: '2026-10-29T01:00:00Z',
  storedBytes: 1,
  rawBytes: 1,
  contentHash: 'abc',
  counts: { places: 20, labels: 1, trips: 0, meetings: 1 },
  deviceId: 'abcdefgh12345678',
  deviceLabel: '시험 기기',
  reason: 'auto',
};
it('없음·날짜·개수·기기·자동 줄을 만든다', () => {
  expect(metaLine(null, new Date())).toBe('서버 백업: 없음');
  expect(metaLine(meta, new Date(meta.createdAt))).toMatch(
    /\(오늘\).*장소 20곳.*약속 1개.*시험 기기 · 자동$/,
  );
  expect(metaLine(meta, new Date(meta.createdAt + 3 * 86400000))).toContain('(3일 전)');
  expect(restoreHeader(meta)).toMatch(/^서버 백업 · .* · 시험 기기$/);
});
it('덮어쓰기 확인을 안전 조건에 맞춘다', () => {
  const now = new Date();
  expect(overwriteConfirmText(null, meta.counts, false, now)).toBeNull();
  expect(overwriteConfirmText(meta, meta.counts, false, now)).toContain(
    '서버 백업을 이 기기 보관함으로 바꿔요',
  );
  expect(overwriteConfirmText(meta, { ...meta.counts, places: 9 }, true, now)).toContain(
    '많이 적어요',
  );
  expect(overwriteConfirmText(meta, meta.counts, true, now)).toBeNull();
});
it.each([
  'auth',
  'not-allowed',
  'offline',
  'server',
  'limit',
  'off',
  'too-large',
  'unsupported',
  'changed',
  'not-found',
  'library',
  'invalid',
] as const)('오류 %s의 안내를 제공한다', (reason) => {
  expect(failureText(reason, 'write')).toBeTruthy();
  expect(failureText(reason, 'restore')).toBeTruthy();
});
it('행동에 맞춰 연결 실패와 한도를 알린다', () => {
  expect(failureText('server', 'read')).toBe('서버 백업을 확인하지 못했어요');
  expect(failureText('limit', 'restore')).toBe(
    '오늘은 서버 백업을 더 받을 수 없어요. 내일 다시 해 주세요',
  );
});
it.each([
  'uploaded',
  'skipped-empty',
  'skipped-shrunk',
  'too-large',
  'unsupported',
  'off',
  'limit',
  'failed',
] as const)('자동 결과 %s를 표시한다', (outcome) => {
  expect(autoOutcomeText({ at: meta.createdAt, outcome })).toMatch(/^자동 백업/);
});
