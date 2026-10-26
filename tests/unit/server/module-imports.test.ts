// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

it('Pages 함수의 import가 Wrangler 기본 자산 모듈 규칙과 겹치지 않는다', () => {
  const conflicts = ['functions', 'src/server'].flatMap((directory) =>
    sourceFiles(directory).flatMap((path) =>
      ts
        .preProcessFile(readFileSync(path, 'utf8'), true, true)
        .importedFiles.filter(({ fileName }) =>
          /\.(?:sql|txt|html|bin|wasm)(?:\.|$)/.test(fileName),
        )
        .map(({ fileName }) => `${path}: ${fileName}`),
    ),
  );
  expect(conflicts).toEqual([]);
});
