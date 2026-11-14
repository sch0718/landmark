import { defineConfig } from '@playwright/test';
import path from 'node:path';

const port = Number(process.env.DEMO_PORT || 8788);
const out = path.resolve(process.env.DEMO_OUT || '.cache/demo-video');

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.demo.ts',
  outputDir: path.join(out, 'pw'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    baseURL: `http://localhost:${port}`,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    // 녹화 크기는 화면 크기와 같아야 한다(크면 왼쪽 위에만 그려지고 나머지는 회색).
    video: { mode: 'on', size: { width: 390, height: 844 } },
  },
  webServer: {
    command: `yarn vite --port ${port} --strictPort`,
    env: {
      VITE_SYNC_DEV_FAKE: '1',
      VITE_MAP_ADAPTER: process.env.VITE_NAVER_MAP_CLIENT_ID ? '' : 'fake',
      VITE_KAKAO_JS_KEY: 'e2e-kakao-key',
    },
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
