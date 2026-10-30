// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const designPath = 'docs/superpowers/specs/2026-10-29-auto-backup-design.md';
it.each([
  [designPath, '## API(3단계 진입점 위)'],
  ['docs/development.md', '#### API·크기·한도와 운영 확인'],
])('%s의 백업 API 표에 계정 경계 머리글과 불일치 응답을 알린다', (path, heading) => {
  const text = readFileSync(path, 'utf8');
  expect(text).toContain(heading);
  const section = text.slice(text.indexOf(heading)).split(/\n#{1,4} /)[0]!;
  const row = section.split('\n').find((line) => line.startsWith('|') && line.includes('`X-Landmark-Backup-User`'));
  expect(row).toBeDefined();
  expect(row).toContain('사용자 ID');
  expect(row).toContain('401');
  expect(row).toContain('`reauth-required`');
});
it('설계의 쓰기 성공 판단은 배치 안의 SELECT로 설명한다', () => {
  const design = readFileSync(designPath, 'utf8');
  const write = design.split('\n').find((line) => line.startsWith('- 쓰기(한 `batch`)'));
  expect(write).toContain('SELECT id FROM library_backups WHERE user_id = ?1');
  expect(write).toContain('같은 트랜잭션');
});
it('README의 서버 백업 기능은 굵은 머리와 마침표를 쓴다', () => {
  expect(readFileSync('README.md', 'utf8')).toMatch(/^- \*\*서버 백업\*\*: .+\.$/m);
});
