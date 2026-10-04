import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;
const isCI = !!process.env.CI;

/**
 * E2E(§8.3). 지도는 `VITE_MAP_ADAPTER=fake`로 DOM 어댑터를 쓰고, 여행 데이터는
 * global setup이 `tests/fixtures/trips/e2e.json`을 `public/data/`로 복사한다.
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
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  },
  projects: [
    {
      name: 'desktop',
      testMatch: ['itinerary.spec.ts', 'concurrent.spec.ts'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      testMatch: ['share.spec.ts'],
      use: { ...devices['iPhone 13'] },
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
