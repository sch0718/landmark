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
