import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  test,
  addButton,
  candidatePanel,
  createGangneungTrip,
  day1Names,
  mockRoutes,
  openSheetTab,
  seedStorage,
  timeline,
} from './fixtures';
import { createTripLiveServer } from './trip-live-server';

const TITLE = '강릉 여행';
const STOPS = ['초당순두부 본점', '경포대', '정동진 해변'];
const TIME = new Date('2026-10-30T10:00:00+09:00');
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
async function otherPage(browser: Browser) {
  const context = await browser.newContext({
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1280, height: 800 },
  });
  contexts.push(context);
  await server.install(context);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  await page.clock.install({ time: TIME });
  await seedStorage(page, { library: false });
  await mockRoutes(page);
  return page;
}
async function prepare(page: Page, browser: Browser) {
  await page.clock.install({ time: TIME });
  await mockRoutes(page);
  await createGangneungTrip(page);
  for (const name of STOPS) await addButton(page, name).click();
  await openSheetTab(page, 'Day 1');
  await expect.poll(() => day1Names(page, STOPS)).toEqual(STOPS);
  await timeline(page).getByRole('button', { name: '일정 공유', exact: true }).click();
  await page.getByRole('button', { name: '갱신 링크…' }).click();
  const live = page.getByRole('dialog', { name: /^갱신 링크/ });
  await live.getByRole('button', { name: '갱신 링크 만들기', exact: true }).click();
  await expect(live.getByRole('textbox', { name: '보기 링크' })).toBeVisible();
  await live.getByRole('button', { name: '함께 편집…' }).click();
  const collab = page.getByRole('dialog', { name: /^함께 편집/ });
  await collab.getByRole('button', { name: '편집 초대 링크 만들기' }).click();
  await expect(collab.getByRole('textbox', { name: '편집 초대 링크' })).toBeVisible();
  await collab.getByRole('button', { name: '링크 복사', exact: true }).click();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  expect(href).toMatch(/\/trips\/join\/[a-z0-9]{10}#i=[A-Za-z0-9_-]{43}$/);
  const editor = await otherPage(browser);
  await editor.goto(href);
  await expect(editor).not.toHaveURL(/#i=/);
  await editor.getByRole('textbox', { name: '이 기기 이름' }).fill('민지 폰');
  await editor.getByRole('button', { name: '수락하고 함께 편집하기' }).click();
  await expect(editor).toHaveURL(/\/trips\/[a-z0-9]{10}$/);
  await expect(
    candidatePanel(editor).getByRole('heading', { name: TITLE, exact: true }),
  ).toBeVisible();
  await expect(editor.getByRole('status').filter({ hasText: '함께 편집 중' })).toBeVisible();
  await openSheetTab(editor, 'Day 1');
  await expect.poll(() => day1Names(editor, STOPS)).toEqual(STOPS);
  await collab.getByRole('button', { name: '닫기', exact: true }).click();
  await live.getByRole('button', { name: '닫기', exact: true }).click();
  await page
    .getByRole('dialog', { name: '일정 공유', exact: true })
    .getByRole('button', { name: '닫기', exact: true })
    .click();
  return { editor, href };
}
async function moveUp(page: Page, name: string) {
  await timeline(page)
    .getByRole('button', { name: `${name} 메뉴`, exact: true })
    .click();
  await page.getByRole('menuitem', { name: '위로', exact: true }).click();
}
async function sameOrder(sender: Page, receiver: Page, wanted: string[]) {
  // 반영 모으기 3초와 최소 쓰기 간격 10초가 모두 지난 뒤 상대의 폴링을 진행한다.
  await sender.clock.runFor(3000);
  await expect(async () => {
    await sender.clock.runFor(10000);
    await receiver.clock.runFor(10000);
    expect(await day1Names(receiver, STOPS)).toEqual(wanted);
  }).toPass({ timeout: 40000 });
}

test.describe('여행 함께 편집 @desktop', () => {
  test('@smoke 편집 초대로 두 기기가 함께 고친다', async ({ page, browser }) => {
    const { editor } = await prepare(page, browser);
    await timeline(editor).getByLabel('출발 시각').fill('10:00');
    await editor.clock.runFor(3000);
    await expect(async () => {
      await page.clock.runFor(10000);
      await expect(page.getByRole('list', { name: 'Day 1 일정' })).toContainText('10:00');
    }).toPass({ timeout: 40000 });
    await expect(
      page.getByRole('status').filter({ hasText: '‘민지 폰’에서 일정을 바꿨어요' }),
    ).toBeVisible();
    await moveUp(page, STOPS[2]!);
    await moveUp(page, STOPS[2]!);
    await sameOrder(page, editor, [STOPS[2]!, STOPS[0]!, STOPS[1]!]);
  });
  test('같은 Day 순서를 동시에 바꾸면 비교 창에서 고른다', async ({ page, browser }) => {
    const { editor } = await prepare(page, browser);
    const api = '**/api/trip-collab/**';
    // 가짜 응답도 오프라인일 때는 전송하지 않도록 막는다.
    await editor.route(api, (route) => route.abort('internetdisconnected'));
    await editor.context().setOffline(true);
    await moveUp(editor, STOPS[1]!);
    await moveUp(page, STOPS[2]!);
    await moveUp(page, STOPS[2]!);
    const ownerOrder = [STOPS[2]!, STOPS[0]!, STOPS[1]!];
    await page.clock.runFor(13000);
    await expect.poll(() => day1Names(page, STOPS)).toEqual(ownerOrder);
    await editor.context().setOffline(false);
    await editor.unroute(api);
    await expect(async () => {
      await editor.clock.runFor(10000);
      await expect(
        editor.getByRole('status').filter({ hasText: '다른 기기와 같은 곳을 고쳤어요 · 1곳' }),
      ).toBeVisible();
    }).toPass({ timeout: 40000 });
    await editor.getByRole('button', { name: '비교하기', exact: true }).click();
    const compare = editor.getByRole('dialog', { name: /겹친 변경 비교/ });
    await compare.getByRole('button', { name: '모두 공동 여행으로' }).click();
    await compare.getByRole('button', { name: '고른 대로 맞추기' }).click();
    await expect(compare).not.toBeVisible();
    await expect.poll(() => day1Names(editor, STOPS)).toEqual(ownerOrder);
    await page.clock.runFor(10000);
    expect(await day1Names(page, STOPS)).toEqual(ownerOrder);
  });
  test('기기를 거두면 그 기기는 더 맞추지 않는다', async ({ page, browser }) => {
    const { editor, href } = await prepare(page, browser);
    await page.getByRole('button', { name: '함께 편집', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /^함께 편집/ });
    await expect(dialog.getByText(/민지 폰 ·/)).toBeVisible();
    await dialog.getByRole('button', { name: '편집 권한 거두기' }).click();
    await page
      .getByRole('dialog', { name: /편집 권한을 거둘까요/ })
      .getByRole('button', { name: '거두기', exact: true })
      .click();
    await expect(async () => {
      await editor.clock.runFor(10000);
      await expect(
        editor.getByRole('status').filter({ hasText: '이 기기의 편집 권한이 거둬졌어요' }),
      ).toBeVisible();
    }).toPass({ timeout: 40000 });
    await editor.goto(new URL('/trips', href).href);
    await expect(editor.getByRole('heading', { name: TITLE, exact: true })).toBeVisible();
    const third = await otherPage(browser);
    await third.goto(href);
    await expect(third.getByText('이미 쓴 초대이거나 닫힌 초대예요')).toBeVisible();
  });
  test('당일 화면에서 체크가 다른 기기에 보인다', async ({ page, browser }) => {
    const { editor } = await prepare(page, browser);
    await page.getByRole('link', { name: '오늘 일정', exact: true }).click();
    await editor.getByRole('link', { name: '오늘 일정', exact: true }).click();
    await page.getByRole('checkbox', { name: `‘${STOPS[0]}’ 다녀옴` }).click();
    await page.clock.runFor(3000);
    await expect(async () => {
      await page.clock.runFor(10000);
      await editor.clock.runFor(10000);
      await expect(editor.getByRole('button', { name: '다녀온 곳 1곳' })).toBeVisible();
    }).toPass({ timeout: 40000 });
    await editor.getByRole('button', { name: '다녀온 곳 1곳' }).click();
    await expect(editor.getByText('다녀옴 · 만든 사람')).toBeVisible();
    await expect(editor.getByRole('region', { name: '다음 장소' }).getByRole('heading')).toHaveText(
      STOPS[1]!,
    );
  });
});
