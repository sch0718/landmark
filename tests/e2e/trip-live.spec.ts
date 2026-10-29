import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  test,
  addButton,
  createGangneungTrip,
  day1Names,
  mockRoutes,
  openSheetTab,
  seedStorage,
  timeline,
} from './fixtures';
import { createTripLiveServer } from './trip-live-server';
const TITLE = '강릉 여행',
  STOPS = ['초당순두부 본점', '경포대'];
let server: ReturnType<typeof createTripLiveServer>;
const contexts: BrowserContext[] = [];
test.beforeEach(async ({ context }) => {
  server = createTripLiveServer();
  await server.install(context);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.addInitScript(() =>
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }),
  );
});
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
  server.close();
});
async function prepare(page: Page) {
  await mockRoutes(page);
  await createGangneungTrip(page);
  for (const name of STOPS) await addButton(page, name).click();
  await openSheetTab(page, 'Day 1');
  await timeline(page).getByRole('button', { name: '일정 공유', exact: true }).click();
  await page.getByRole('button', { name: '갱신 링크…' }).click();
  const dialog = page.getByRole('dialog', { name: '갱신 링크', exact: true });
  await dialog.getByRole('button', { name: '갱신 링크 만들기' }).click();
  await expect(dialog.getByRole('textbox', { name: '보기 링크' })).toBeVisible();
  await dialog.getByRole('button', { name: '링크 복사', exact: true }).click();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  expect(href).toMatch(/\/view#t=[a-z0-9]{10}\.[A-Za-z0-9_-]{43}$/);
  return { dialog, href };
}
async function receiver(browser: Browser, href: string) {
  const context = await browser.newContext();
  contexts.push(context);
  await server.install(context);
  const page = await context.newPage();
  await page.clock.install();
  await page.goto(href);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE);
  return page;
}
test.describe('여행 갱신 공유 @desktop', () => {
  test('@smoke 갱신 링크를 만들고 소유자가 고치면 받는 화면이 10초 뒤 바뀐다', async ({
    page,
    browser,
  }) => {
    const { dialog, href } = await prepare(page),
      viewer = await receiver(browser, href);
    await expect(viewer.locator('.live-bar')).toContainText('보낸 사람이 일정을 고치면');
    await dialog.getByRole('button', { name: '닫기', exact: true }).click();
    await page
      .getByRole('dialog', { name: '일정 공유', exact: true })
      .getByRole('button', { name: '닫기', exact: true })
      .click();
    await timeline(page).getByLabel('출발 시각').fill('10:00');
    // 표시 시각은 분 단위이므로 같은 분에 올려도 증가하는 revision으로 완료를 기다린다.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const records = JSON.parse(
              localStorage.getItem('tripmap:trip-live:v1') ?? '{}',
            ) as Record<string, { rev: number }>;
            return Object.values(records)[0]?.rev ?? 0;
          }),
        { timeout: 20000 },
      )
      .toBeGreaterThan(1);
    await viewer.clock.runFor(10000);
    await expect(viewer.locator('.live-bar')).toContainText('일정이 바뀌었어요');
    await expect(viewer.getByRole('list', { name: 'Day 1 일정' })).toContainText('10:00');
  });
  test('보기 링크를 다시 만들거나 지우면 받는 화면이 멈추고 마지막 일정을 남긴다', async ({
    page,
    browser,
  }) => {
    const { dialog, href } = await prepare(page),
      viewer = await receiver(browser, href);
    await dialog.getByRole('button', { name: '보기 링크 다시 만들기' }).click();
    await page
      .getByRole('dialog', { name: '보기 링크 다시 만들기' })
      .getByRole('button', { name: '다시 만들기', exact: true })
      .click();
    await viewer.clock.runFor(10000);
    await expect(viewer.locator('.live-bar')).toContainText('보낸 사람이 이 링크를 닫았어요');
    await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(TITLE);
    await expect(viewer.getByRole('button', { name: '파일로 저장' })).toBeVisible();
    const fresh = await dialog.getByRole('textbox', { name: '보기 링크' }).inputValue(),
      second = await receiver(browser, fresh);
    await dialog.getByRole('button', { name: '서버에서 지우기' }).click();
    await page
      .getByRole('dialog', { name: '서버에서 지우기' })
      .getByRole('button', { name: '지우기', exact: true })
      .click();
    await second.clock.runFor(10000);
    await expect(second.locator('.live-bar')).toContainText('공유가 끝난 일정이에요');
    await expect(second.getByRole('button', { name: '파일로 저장' })).toBeVisible();
  });
  test('소유자 링크로 다른 기기가 담고 관리한다', async ({ page, browser }) => {
    const { dialog } = await prepare(page);
    await dialog.getByRole('button', { name: '다른 기기에서 관리' }).click();
    const href = await page.evaluate(() => navigator.clipboard.readText());
    expect(href).toMatch(/\/trips\/live\/[a-z0-9]{10}#h=/);
    const context = await browser.newContext();
    contexts.push(context);
    await server.install(context);
    const other = await context.newPage();
    await seedStorage(other, { library: false });
    await mockRoutes(other);
    await other.goto(href);
    await expect(other.getByRole('button', { name: '이 기기에서 관리하기' })).toBeVisible();
    await expect(other).not.toHaveURL(/#h=/);
    await other.getByRole('button', { name: '이 기기에서 관리하기' }).click();
    await expect(other).toHaveURL(/\/trips\/[a-z0-9]{10}$/);
    await openSheetTab(other, 'Day 1');
    await expect.poll(() => day1Names(other, STOPS)).toEqual(STOPS);
  });
});
