import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;
const isCI = !!process.env.CI;

/**
 * E2E(스펙 §8). 지도는 `VITE_MAP_ADAPTER=fake`로 DOM 어댑터를 쓰고, 옛 여행 가져오기용 데이터는
 * global setup이 `tests/fixtures/trips/e2e.json`을 `public/data/`로 복사한다.
 * 프로젝트: desktop(Chromium 1280×800) · iphone(WebKit 390×844) · galaxy(Chromium 360×780, 터치).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  },
  projects: [
    {
      name: 'desktop',
      grepInvert: /@mobile/,
      testMatch: ['library.spec.ts', 'legacy-import.spec.ts', 'themes.spec.ts'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'iphone',
      grepInvert: /@desktop/,
      testMatch: ['library.spec.ts', 'themes.spec.ts'],
      use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'galaxy',
      grepInvert: /@desktop/,
      testMatch: ['library.spec.ts'],
      use: {
        ...devices['Galaxy S9+'],
        browserName: 'chromium',
        viewport: { width: 360, height: 780 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `yarn vite --port ${PORT} --strictPort`,
    env: { VITE_MAP_ADAPTER: 'fake' },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
