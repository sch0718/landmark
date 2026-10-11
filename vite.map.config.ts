import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * 지도 페이지 빌드: `dist-map/`(gitignore)에 `index.html`과 `assets/`를 만든다.
 * GitHub Pages(`https://sch0718.github.io/landmark/`)에 그대로 올리므로 경로는 상대(`base: './'`)다.
 * 지도는 네이버 지도 JS v3다. 네이버는 Referer로 등록 도메인(`https://sch0718.github.io`)을 인증하므로
 * HTML에 referrer 정책 메타를 넣지 않는다.
 * 빌드 변수: `VITE_NAVER_MAP_CLIENT_ID`(앱과 같은 이름, 저장소 루트 `.env.local` 또는 CI 변수),
 * `VITE_MAP_ADAPTER=fake`면 DOM 가짜 지도(e2e).
 */
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: here('./src/share-map'),
  base: './',
  // 지도 페이지에 앱의 public 파일을 섞지 않는다.
  publicDir: false,
  // root가 src/share-map이라 기본값이면 그 폴더의 .env만 읽는다. 앱과 같은 저장소 루트의 .env*를 읽는다.
  envDir: here('.'),
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
