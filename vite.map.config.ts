import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * 지도 페이지 빌드: `dist-map/`(gitignore)에 `index.html`과 `assets/`를 만든다.
 * GitHub Pages(`https://sch0718.github.io/landmark/`)에 그대로 올리므로 경로는 상대(`base: './'`)다.
 * OSM 타일 서버가 Referer를 받아야 하므로 HTML에 referrer 정책 메타를 넣지 않는다.
 */
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: here('./src/share-map'),
  base: './',
  // 지도 페이지에 앱의 public 파일을 섞지 않는다.
  publicDir: false,
  resolve: {
    alias: {
      src: here('./src'),
    },
  },
  build: {
    outDir: here('./dist-map'),
    emptyOutDir: true,
    rolldownOptions: {
      input: here('./src/share-map/index.html'),
    },
  },
});
