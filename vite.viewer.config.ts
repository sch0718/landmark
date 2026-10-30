import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { inlineAssets } from './build/inline-assets.ts';

/**
 * 보기 화면 틀 빌드: JS·CSS를 모두 넣은 HTML 하나를 `public/share-viewer.html`로 만든다(gitignore).
 * 앱이 런타임에 이 파일을 받아 데이터 자리 `__TRIPMAP_DATA__`를 채운다.
 * `public/`에는 다른 파일(`_headers`, `data/`)이 있으므로 비우지 않는다.
 */
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

function linkViewerHtml(template: string): string {
  const count = template.split('__TRIPMAP_DATA__').length - 1;
  if (count !== 1)
    throw new Error(`보기 화면 틀의 데이터 자리는 정확히 1개여야 합니다(현재 ${count}개)`);
  return template.replace('__TRIPMAP_DATA__', '');
}

export default defineConfig({
  root: here('./src/share-viewer'),
  base: './',
  // 결과 폴더가 앱의 public이라, 이 빌드의 public 복사는 끈다.
  publicDir: false,
  plugins: [
    inlineAssets({ fileName: 'share-viewer.html' }),
    {
      name: 'tripmap:link-viewer',
      writeBundle() {
        // Pages는 view.html을 /view로 제공한다. 파일용 틀에는 데이터 자리를 그대로 남긴다.
        const template = readFileSync(here('./public/share-viewer.html'), 'utf8');
        writeFileSync(here('./public/view.html'), linkViewerHtml(template));
      },
    },
  ],
  resolve: {
    alias: {
      src: here('./src'),
    },
  },
  build: {
    outDir: here('./public'),
    emptyOutDir: false,
    assetsInlineLimit: Infinity,
    modulePreload: false,
    rolldownOptions: {
      input: here('./src/share-viewer/index.html'),
    },
  },
});
