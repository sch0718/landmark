import { fileURLToPath } from 'node:url';
import { defineConfig, type ViteUserConfig } from 'vitest/config';
import Icons from 'unplugin-icons/vite';
import { compileReactIcon } from './build/compile-react-svg-icon.ts';

const existingConfig: ViteUserConfig = {
  resolve: {
    alias: {
      src: fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    maxWorkers: 2,
    // 날짜 시험(다녀온 날 등)이 UTC 서버에서도 한국 시각 기준으로 같게 돈다.
    // 카카오 공유 키와 동기화 로그인 공개 설정은 빌드 환경(Pages)에 있어도 비운다. 값이 있으면 설정 화면에
    // 동기화·서버 백업 구역이 생겨 화면 시험이 깨진다(2026-10-31 배포 실패). 값이 필요한 시험은 `vi.stubEnv`로 넣는다.
    env: {
      TZ: 'Asia/Seoul',
      VITE_KAKAO_JS_KEY: '',
      VITE_FIREBASE_API_KEY: '',
      VITE_FIREBASE_AUTH_DOMAIN: '',
      VITE_FIREBASE_PROJECT_ID: '',
      VITE_FIREBASE_APP_ID: '',
      VITE_KAKAO_LOGIN_CLIENT_ID: '',
      VITE_NAVER_LOGIN_CLIENT_ID: '',
    },
    // 테스트 하나의 제한 시간. 배포 빌드(Cloudflare Pages의 `yarn build:ci`)는 로컬보다 3~4배 느려, 로컬 1.2초인
    // 화면 테스트가 기본값 5초를 넘긴 적이 있다(2026-10-15, export-lazy). 화면 요소를 기다리는 시간(`findBy`)은 그대로다.
    testTimeout: 20_000,
  },
  plugins: [],
};

export default defineConfig({
  ...existingConfig,
  plugins: [
    ...(existingConfig.plugins ?? []),
    Icons({ compiler: { compiler: compileReactIcon, extension: 'jsx' } }),
  ],
});
