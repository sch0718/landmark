// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('갱신 공유 개발 안내는 에이전트 지시와 연속 빈 줄 없이 제공한다', () => {
  const doc = readFileSync(new URL('../../../docs/development.md', import.meta.url), 'utf8');
  const section = doc.split('### 여행 갱신 공유(`/view#t=`)')[1]!.split('### 화면 경로')[0]!;
  expect(section).not.toContain('에이전트');
  expect(section).not.toMatch(/\n{3,}/);
});
