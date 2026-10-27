import { expect } from '@playwright/test';
import { test, seedStorage } from './fixtures';

const THEMES = ['pastel', 'paper', 'night'] as const;
const MODES = ['light', 'dark'] as const;

/** 테마 3종 × 라이트/다크로 보관함을 찍어 산출물로 남긴다. 화면 비교 단언은 하지 않는다. */
for (const theme of THEMES) {
  for (const mode of MODES) {
    test(`스크린샷: ${theme} ${mode}`, async ({ page }, testInfo) => {
      await seedStorage(page, { prefs: { theme, mode, libraryView: 'bento' } });
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
      await expect(page.getByRole('group', { name: '라벨 개요' })).toBeVisible();
      if (testInfo.project.name === 'desktop') {
        await expect(page.locator('[data-testid^="marker-"]').first()).toBeVisible();
      }
      await page.screenshot({
        path: `test-results/themes/${testInfo.project.name}-${theme}-${mode}.png`,
      });
    });
  }
}
