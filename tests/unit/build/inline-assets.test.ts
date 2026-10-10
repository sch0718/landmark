import { describe, expect, it } from 'vitest';
import { inlineAssets } from '../../../build/inline-assets';

type FakeEntry =
  | { type: 'asset'; fileName: string; source: string }
  | { type: 'chunk'; fileName: string; code: string };
type FakeBundle = Record<string, FakeEntry>;

/**
 * 훅이 함수이든 `{ handler }` 객체이든 `generateBundle`을 부른다.
 * `emitFile`은 Rolldown처럼 번들에 자산을 더한다(Rolldown은 `bundle`에 직접 넣은 키를 무시한다).
 */
function runGenerateBundle(bundle: FakeBundle, options?: Parameters<typeof inlineAssets>[0]) {
  const plugin = inlineAssets(options);
  const hook = plugin.generateBundle;
  const handler = typeof hook === 'function' ? hook : hook?.handler;
  if (handler === undefined) throw new Error('generateBundle 없음');
  const ctx = {
    emitFile(file: { type: 'asset'; fileName: string; source: string }) {
      bundle[file.fileName] = { type: 'asset', fileName: file.fileName, source: file.source };
      return file.fileName;
    },
  };
  (handler as (this: unknown, ...args: unknown[]) => void).call(ctx, {}, bundle, false);
  return plugin;
}

function fakeBundle(): FakeBundle {
  return {
    'index.html': {
      type: 'asset',
      fileName: 'index.html',
      source:
        '<html><head><script type="module" crossorigin src="./assets/a.js"></script>' +
        '<link rel="stylesheet" crossorigin href="./assets/a.css"></head><body></body></html>',
    },
    'assets/a.js': { type: 'chunk', fileName: 'assets/a.js', code: 'x("</script>"); y("$&")' },
    'assets/a.css': { type: 'asset', fileName: 'assets/a.css', source: 'b{}' },
  };
}

function htmlOf(bundle: FakeBundle, key: string): string {
  const entry = bundle[key];
  if (entry?.type !== 'asset') throw new Error(`${key} 없음`);
  return entry.source;
}

describe('inlineAssets', () => {
  it('빌드에만, 다른 플러그인 뒤에 돈다', () => {
    const plugin = inlineAssets();
    expect(plugin.apply).toBe('build');
    expect(plugin.enforce).toBe('post');
  });

  it('모듈 스크립트와 스타일시트를 HTML 안에 넣고 그 청크·자산을 지운다', () => {
    const bundle = fakeBundle();
    runGenerateBundle(bundle);
    const html = htmlOf(bundle, 'index.html');

    expect(html).toContain('<script type="module">');
    expect(html).toContain('x("<\\/script>")');
    expect(html).not.toContain('x("</script>")');
    // `$&` 같은 치환 패턴이 해석되지 않고 그대로 남는다.
    expect(html).toContain('y("$&")');
    expect(html).toContain('<style>b{}</style>');
    expect(html).not.toMatch(/\ssrc=/);
    expect(html).not.toMatch(/\shref=/);
    expect(html).not.toContain('crossorigin');
    expect(Object.keys(bundle)).toEqual(['index.html']);
  });

  it('스타일 안의 </style도 끊기지 않게 바꾼다', () => {
    const bundle = fakeBundle();
    const css = bundle['assets/a.css'];
    if (css?.type === 'asset') css.source = 'a::after{content:"</style>"}';
    runGenerateBundle(bundle);
    const html = htmlOf(bundle, 'index.html');
    expect(html.match(/<\/style>/g)).toHaveLength(1);
    expect(html).toContain('<\\/style>');
  });

  it('fileName을 주면 HTML 결과 이름을 바꾼다', () => {
    const bundle = fakeBundle();
    runGenerateBundle(bundle, { fileName: 'share-viewer.html' });
    expect(Object.keys(bundle)).toEqual(['share-viewer.html']);
    const entry = bundle['share-viewer.html'];
    expect(entry?.fileName).toBe('share-viewer.html');
    expect(htmlOf(bundle, 'share-viewer.html')).toContain('<style>b{}</style>');
  });

  it('번들에 없는 주소를 가리키는 태그는 건드리지 않는다', () => {
    const bundle: FakeBundle = {
      'index.html': {
        type: 'asset',
        fileName: 'index.html',
        source: '<script type="module" crossorigin src="https://cdn.example/x.js"></script>',
      },
    };
    runGenerateBundle(bundle);
    expect(htmlOf(bundle, 'index.html')).toContain('src="https://cdn.example/x.js"');
  });
});
