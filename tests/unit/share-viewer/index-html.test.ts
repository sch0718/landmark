import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHARE_DATA_PLACEHOLDER } from 'src/domain/share/inject';

const html = readFileSync('src/share-viewer/index.html', 'utf8');

describe('보기 화면 틀(index.html)', () => {
  it('데이터 블록이 한 줄로 있고 자리 문자열은 그 안에 한 번만 나온다', () => {
    expect(html).toContain(
      `<script type="application/json" id="tripmap-share">${SHARE_DATA_PLACEHOLDER}</script>`,
    );
    expect(html.split(SHARE_DATA_PLACEHOLDER)).toHaveLength(2);
  });

  it('charset·viewport 메타와 모듈 진입점이 있고 본문은 비어 있다', () => {
    expect(html).toContain('<meta charset="utf-8" />');
    expect(html).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    );
    expect(html).toContain('<script type="module" src="./main.ts"></script>');
    expect(html).toMatch(/<body><\/body>/);
  });
});
