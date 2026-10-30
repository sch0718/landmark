// @vitest-environment node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';

let config: { plugins: Plugin[] };
beforeAll(async () => {
  const path = fileURLToPath(new URL('../../../vite.viewer.config.ts', import.meta.url));
  config = (await import(path)).default;
});

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

function writeTemplate(template: string) {
  vi.mocked(readFileSync).mockReturnValue(template);
  const plugin = (config.plugins as Plugin[]).find((p) => p.name === 'tripmap:link-viewer')!;
  const hook = plugin.writeBundle;
  const handler = typeof hook === 'function' ? hook : hook?.handler;
  if (!handler) throw new Error('writeBundle이 없어요');
  (handler as (...args: unknown[]) => void)({}, {});
}

beforeEach(() => vi.clearAllMocks());

it('데이터 자리가 한 개면 빌드를 허용하고 링크용 HTML에서만 비운다', () => {
  writeTemplate('<script>__TRIPMAP_DATA__</script>');
  expect(writeFileSync).toHaveBeenCalledWith(
    expect.stringContaining('/public/view.html'),
    '<script></script>',
  );
});

it.each([0, 2])('데이터 자리가 %i개면 파일을 쓰기 전에 빌드를 실패시킨다', (count) => {
  expect(() => writeTemplate('__TRIPMAP_DATA__'.repeat(count))).toThrow(/데이터 자리.*1개/);
  expect(writeFileSync).not.toHaveBeenCalled();
});
