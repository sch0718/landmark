import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  E2E_FIXTURE_FILE,
  E2E_PUBLIC_ID,
  TRIP_PATH,
  openTrip,
  placeName,
  submitNickname,
} from './trip';

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function closeDetail(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
}

test('세 뷰 전환·검색·상세와 반응형 배치 @smoke', async ({ page }) => {
  await openTrip(page, `${TRIP_PATH}?view=places`);
  const firstCard = (await page.getByRole('article').nth(0).boundingBox())!;
  const secondCard = (await page.getByRole('article').nth(1).boundingBox())!;
  expect(secondCard.x).toBeGreaterThan(firstCard.x);
  expect(secondCard.y).toBe(firstCard.y);
  await page.getByRole('button', { name: '목록', exact: true }).click();
  const firstRow = (await page
    .getByRole('button', { name: `${placeName(1)} 상세`, exact: true })
    .boundingBox())!;
  const secondRow = (await page
    .getByRole('button', { name: `${placeName(2)} 상세`, exact: true })
    .boundingBox())!;
  expect(secondRow.x).toBe(firstRow.x);
  expect(secondRow.y).toBeGreaterThanOrEqual(firstRow.y + firstRow.height);
  await page.getByRole('button', { name: '카드', exact: true }).click();
  await page.getByRole('textbox', { name: '검색', exact: true }).fill(placeName(1));
  await page.getByRole('button', { name: `${placeName(1)} 상세`, exact: true }).click();
  await expect(page.getByRole('dialog', { name: '장소 상세' })).toBeVisible();
  await closeDetail(page);
  await page.getByRole('button', { name: '목록', exact: true }).click();
  await expect(page.getByRole('list', { name: '장소 목록' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '검색', exact: true })).toHaveValue(placeName(1));
  await noOverflow(page);
  expect((await page.getByRole('banner').boundingBox())!.y).toBe(0);
  expect((await page.getByRole('banner').boundingBox())!.y).toBe(0);
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page).toHaveURL(/[?&]view=day/);
  await expect(page.getByTestId('itinerary-panel')).toBeVisible();
  await noOverflow(page);
  expect((await page.getByRole('banner').boundingBox())!.y).toBe(0);
  await page.getByRole('button', { name: '지도', exact: true }).click();
  await expect(page).toHaveURL(/[?&]view=map/);
  await expect(page.getByTestId('map-host')).toBeVisible();
  await noOverflow(page);
  await page.reload();
  await expect(page.getByTestId('trip-shell')).toHaveAttribute('data-view', 'map');
});

test('작성 중인 메모가 닫기·모드 전환 후 남고 저장하면 다른 뷰에도 반영된다 @smoke', async ({
  page,
}) => {
  await openTrip(page, `${TRIP_PATH}?view=places`);
  await page.getByRole('button', { name: `${placeName(1)} 상세`, exact: true }).click();
  await page.getByRole('button', { name: '메모 추가', exact: true }).click();
  await page.getByLabel('내 메모', { exact: true }).fill('작성 중인 메모');
  await closeDetail(page);
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await page.getByRole('button', { name: '장소', exact: true }).click();
  await page.getByRole('button', { name: `${placeName(1)} 상세`, exact: true }).click();
  await expect(page.getByLabel('내 메모', { exact: true })).toHaveValue('작성 중인 메모');
  await page.getByRole('dialog').getByRole('button', { name: '저장', exact: true }).click();
  await submitNickname(page, '여행자');
  await expect(page.getByRole('dialog').getByText('작성 중인 메모', { exact: true })).toBeVisible();
  await closeDetail(page);
  await page.getByRole('button', { name: '지도', exact: true }).click();
  await page.getByTestId('marker-n:1001').click();
  await expect(page.getByRole('dialog').getByText('작성 중인 메모', { exact: true })).toBeVisible();
});

test('카드에서 날짜를 선택해 추가하고 일정에서 확인한다 @smoke', async ({ page }) => {
  await openTrip(page, `${TRIP_PATH}?view=places`);
  await page.getByRole('button', { name: `${placeName(7)} 일정에 추가`, exact: true }).click();
  await page.getByRole('button', { name: 'Day 2 (11/15)', exact: true }).click();
  await submitNickname(page, '여행자');
  await expect(page.getByRole('dialog', { name: '일정에 추가' })).toBeHidden();
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await page.getByRole('tab', { name: 'Day 2', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Day 2 (11/15) 타임라인' })).toContainText(
    placeName(7),
  );
  await page.reload();
  await expect(page.getByRole('list', { name: 'Day 2 (11/15) 타임라인' })).toContainText(
    placeName(7),
  );
});

test('모바일 시트 peek·half 실제 경계와 마커 tap 선택 @smoke', async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(!isMobile, '모바일 컨텍스트의 실제 bounds/touch 검사');
  await openTrip(page, `${TRIP_PATH}?view=map`);
  const panel = page.getByTestId('view-panel');
  const peek = (await panel.boundingBox())!;
  const summary = (await page.getByRole('button', { name: '시트 크기 조절' }).boundingBox())!;
  const entry = (await page.getByRole('button', { name: '목록 보기', exact: true }).boundingBox())!;
  expect(summary.y).toBeGreaterThanOrEqual(peek.y);
  expect(entry.y + entry.height).toBeLessThanOrEqual(peek.y + peek.height);
  await page.getByRole('button', { name: '시트 크기 조절' }).tap();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeGreaterThan(peek.height);
  const half = (await panel.boundingBox())!;
  const first = (await page
    .getByRole('button', { name: `${placeName(1)} 상세`, exact: true })
    .boundingBox())!;
  expect(first.y).toBeGreaterThan(half.y);
  expect(first.y + first.height).toBeLessThanOrEqual(half.y + half.height);
  await page.screenshot({ path: testInfo.outputPath('sheet-half.png'), fullPage: true });
  const firstItem = (await page
    .getByRole('list', { name: '장소 목록' })
    .locator('li')
    .first()
    .boundingBox())!;
  expect(firstItem.y + firstItem.height).toBeLessThanOrEqual(half.y + half.height);
  await page.getByTestId('marker-n:1001').tap();
  await expect(page.getByRole('dialog', { name: '장소 상세' })).toBeVisible();
  await expect(page.getByTestId('place-card-n:1001')).toContainText(placeName(1));
});

test('데스크톱 크기·경계 변경에도 지도 인스턴스와 docking을 유지한다 @smoke', async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(isMobile, 'desktop OS 컨텍스트에서만 viewport resize');
  await openTrip(page, `${TRIP_PATH}?view=map`);
  const host = await page.getByTestId('map-host').elementHandle();
  const instance = await page.getByTestId('fake-map').getAttribute('data-instance-id');
  for (const [width, height] of [
    [390, 844],
    [767, 900],
    [768, 1024],
    [1280, 800],
    [1439, 900],
    [1440, 900],
    [1920, 1080],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByTestId('trip-shell')).toHaveAttribute(
      'data-layout',
      width < 768 ? 'compact' : width < 1440 ? 'split' : 'wide',
    );
    await expect
      .poll(async () => (await page.getByTestId('trip-shell').boundingBox())!.width)
      .toBe(width);
    expect(
      await host!.evaluate((el) => el === document.querySelector('[data-testid="map-host"]')),
    ).toBe(true);
    await expect(page.getByTestId('fake-map')).toHaveAttribute('data-instance-id', instance!);
    await page.getByTestId('marker-n:1001').click();
    const detail = page.locator('[data-detail-presentation]');
    await expect(detail).toHaveAttribute(
      'data-detail-presentation',
      width < 768 ? 'bottom' : width < 1440 ? 'overlay' : 'docked',
    );
    expect(
      await page
        .getByTestId('trip-body')
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length),
    ).toBe(width < 768 ? 1 : width < 1440 ? 2 : 3);
    if (width >= 1440) {
      const map = (await page.getByTestId('trip-map-area').boundingBox())!;
      const panel = (await page.getByTestId('view-panel').boundingBox())!;
      const dock = (await detail.boundingBox())!;
      expect(panel.x).toBeGreaterThanOrEqual(map.x + map.width - 1);
      expect(dock.x).toBeGreaterThanOrEqual(panel.x + panel.width - 1);
      expect(dock.width).toBe(320);
      await page.screenshot({ path: testInfo.outputPath(`docked-${width}.png`), fullPage: true });
    }
    await noOverflow(page);
    await closeDetail(page);
  }
});

test('긴 제목·장소명·3줄 메모가 카드와 목록에서 넘치지 않는다', async ({ page }, testInfo) => {
  const fixture = JSON.parse(await readFile(E2E_FIXTURE_FILE, 'utf8'));
  fixture.title = '가족과 함께하는 아주 긴 여행 제목 '.repeat(8);
  const longName = '길고 긴 장소 이름과 세부 설명 '.repeat(12);
  fixture.places['n:1001'].name = longName;
  await page.route(`**/data/${E2E_PUBLIC_ID}.json`, (route) => route.fulfill({ json: fixture }));
  await page.goto(`${TRIP_PATH}?view=places`);
  await expect(page.getByRole('heading', { name: fixture.title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: `${longName} 상세`, exact: true }).click();
  await page.getByRole('button', { name: '메모 추가', exact: true }).click();
  const memo = '첫째 줄 긴 메모\n둘째 줄 긴 메모\n셋째 줄 긴 메모';
  await page.getByLabel('내 메모', { exact: true }).fill(memo);
  await page.getByRole('dialog').getByRole('button', { name: '저장', exact: true }).click();
  await submitNickname(page, '여행자');
  await expect(page.getByRole('dialog').getByText(memo, { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('long-detail.png'), fullPage: true });
  await closeDetail(page);
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('long-cards.png'), fullPage: true });
  await page.getByRole('button', { name: '목록', exact: true }).click();
  await expect(page.getByRole('list', { name: '장소 목록' })).toContainText(longName);
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('long-list.png'), fullPage: true });
});

test('legacy URL은 reload 후 유지되고 뷰 변경 시 정규화된다 @smoke', async ({ page }) => {
  await openTrip(page, `${TRIP_PATH}?mode=itinerary&day=1`);
  await expect(page.getByRole('tab', { name: 'Day 1', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.reload();
  await expect(page).toHaveURL(/\?mode=itinerary&day=1$/);
  await page.getByRole('button', { name: '장소', exact: true }).click();
  await expect(page).toHaveURL(/[?&]view=places/);
  expect(new URL(page.url()).searchParams.has('mode')).toBe(false);
});

test('키 없는 Naver 환경에서도 목록 전용 진입과 장소 상세가 동작한다 @smoke', async ({
  page,
}, testInfo) => {
  const sdkRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('maps.js')) sdkRequests.push(request.url());
  });
  await openTrip(page, `http://localhost:5174${TRIP_PATH}?view=map`);
  await expect(page.getByRole('alert')).toContainText('지도 키가 설정되지 않았어요');
  await expect(page.getByTestId('map-host')).toHaveCount(0);
  await expect(page.getByRole('list', { name: '장소 목록' })).toBeVisible();
  await page.getByRole('button', { name: `${placeName(1)} 상세`, exact: true }).click();
  await expect(page.getByRole('dialog', { name: '장소 상세' })).toBeVisible();
  await noOverflow(page);
  expect(sdkRequests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('map-keyless.png'), fullPage: true });
});

test('검색 focus 후에도 상단과 문서 세로 위치를 유지한다', async ({ page, isMobile }, testInfo) => {
  if (isMobile && testInfo.project.name === 'mobile')
    await page.setViewportSize({ width: 390, height: 664 });
  await openTrip(page, `${TRIP_PATH}?view=places`);
  const measurements: unknown[] = [];
  const measure = async (stage: string) => {
    const value = await page.evaluate(
      (stage) => ({
        stage,
        scrollY,
        innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
        viewport: { height: visualViewport?.height, offsetTop: visualViewport?.offsetTop },
        header: document.querySelector('header')?.getBoundingClientRect().toJSON(),
      }),
      stage,
    );
    measurements.push(value);
    return value;
  };
  await measure('before');
  await page.getByRole('button', { name: '목록', exact: true }).click();
  await page.getByRole('button', { name: '카드', exact: true }).click();
  await page.getByRole('textbox', { name: '검색', exact: true }).fill(placeName(1));
  await measure('focus');
  await page.getByRole('button', { name: `${placeName(1)} 상세`, exact: true }).click();
  await closeDetail(page);
  await measure('detail-closed');
  await page.getByRole('button', { name: '목록', exact: true }).click();
  const list = await measure('list');
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await measure('day');
  await page.getByRole('button', { name: '장소', exact: true }).click();
  const last = await measure('places');
  await writeFile(
    testInfo.outputPath('viewport-measurements.json'),
    JSON.stringify(measurements, null, 2),
  );
  await testInfo.attach('viewport-measurements', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({ path: testInfo.outputPath('search-focus.png'), fullPage: true });
  expect(list.scrollY).toBe(0);
  expect(list.header?.y).toBeGreaterThanOrEqual(0);
  expect(last.scrollY).toBe(0);
  expect(last.header?.y).toBeGreaterThanOrEqual(0);
});

test('500곳 목록의 처음·끝·검색과 marker 선택이 동작한다 @smoke', async ({ page }) => {
  await useVirtualFixture(page);
  await openTrip(page, `${TRIP_PATH}?view=places`);
  const host = page.getByTestId('view-scroll');
  const rows = page.locator('[data-place-key]');
  await expect(page.locator('[data-place-count="500"]')).toBeVisible();
  await expect(page.locator('[data-place-key="n:1001"]')).toBeInViewport();
  expect(await rows.count()).toBeLessThan(100);
  await host.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.locator('[data-place-key="n:1500"]')).toBeInViewport();
  await page.getByRole('button', { name: '회귀 장소 500 상세', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '장소 상세' })).toContainText('회귀 장소 500');
  await closeDetail(page);
  await page.getByRole('button', { name: '지도', exact: true }).click();
  await expect(page.locator('[data-testid^="marker-"]')).toHaveCount(500);
  await page.getByTestId('marker-n:1001').click();
  await expect(page.getByRole('dialog', { name: '장소 상세' })).toContainText('회귀 장소 001');
  await closeDetail(page);
  await expect(page.locator('[data-place-key="n:1001"]')).toBeInViewport();
  await page.getByRole('button', { name: '장소', exact: true }).click();
  await page.getByRole('textbox', { name: '검색', exact: true }).fill('회귀 장소 500');
  await expect(page.locator('[data-place-key]')).toHaveCount(1);
  await expect(page.locator('[data-place-key="n:1500"]')).toBeVisible();
  await page.getByRole('textbox', { name: '검색', exact: true }).fill('없을_검색어');
  await expect(page.getByText('조건에 맞는 장소가 없어요')).toBeVisible();
  await expect(rows).toHaveCount(0);
});

test('60과61 경계에서 필터 왕복·선택·복원 소유자가 일관된다', async ({ page, isMobile }) => {
  const data = JSON.parse(await readFile(E2E_FIXTURE_FILE, 'utf8'));
  const source = data.places['n:1001'];
  data.places = Object.fromEntries(
    Array.from({ length: 61 }, (_, i) => [
      `n:${1001 + i}`,
      { ...source, sid: String(1001 + i), name: `${i < 60 ? '포함' : '제외'}${i + 1}` },
    ]),
  );
  data.folders[0].count = 61;
  await page.route('**/data/e2etest000001.json', (route) => route.fulfill({ json: data }));
  await openTrip(page, `${TRIP_PATH}?view=places`);
  const host = page.getByTestId('view-scroll');
  await expect(page.locator('[data-place-count="61"]')).toBeVisible();
  expect(await page.locator('[data-place-key]').count()).toBeLessThan(61);
  await page.getByRole('textbox', { name: '검색', exact: true }).fill('포함');
  await expect(page.locator('[data-place-count="60"]')).toBeVisible();
  await expect(page.locator('[data-place-key]')).toHaveCount(60);
  await host.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.locator('[data-place-key="n:1060"]')).toBeInViewport();
  const saved = await host.evaluate((el) => el.scrollTop);
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await page.getByRole('button', { name: '장소', exact: true }).click();
  await expect
    .poll(async () => Math.abs((await host.evaluate((el) => el.scrollTop)) - saved))
    .toBeLessThan(2);
  await page.getByRole('textbox', { name: '검색', exact: true }).fill('');
  await expect(page.locator('[data-place-count="61"]')).toBeVisible();
  await expect.poll(async () => host.evaluate((el) => el.scrollTop)).toBe(0);
  await page.getByRole('button', { name: '지도', exact: true }).click();
  if (isMobile) {
    await page.setViewportSize({ width: page.viewportSize()!.width, height: 1000 });
    await expect(page.getByTestId('marker-n:1061')).toBeVisible();
    await nextTwoFrames(page);
    const marker = (await page.getByTestId('marker-n:1061').boundingBox())!;
    const sheet = (await page.getByTestId('view-panel').boundingBox())!;
    expect(marker.y + marker.height).toBeLessThanOrEqual(sheet.y);
  }
  await expect(page.getByTestId('fake-map').locator('button')).toHaveCount(61);
  await page.getByTestId('marker-n:1061').click();
  await closeDetail(page);
  await expect(page.locator('[data-place-key="n:1061"]')).toBeInViewport();
  await expect(page.locator('[data-index="60"] [data-place-key="n:1061"]')).toBeVisible();
  await host.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.getByTestId('marker-n:1061').click();
  await closeDetail(page);
  await expect(page.locator('[data-place-key="n:1061"]')).toBeInViewport();
});

async function useVirtualFixture(page: Page, count = 500) {
  const data = JSON.parse(await readFile(E2E_FIXTURE_FILE, 'utf8'));
  const original = data.places['n:1001'];
  data.places = Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `n:${1001 + index}`,
      {
        ...original,
        sid: String(1001 + index),
        name: `회귀 장소 ${String(index + 1).padStart(3, '0')}`,
      },
    ]),
  );
  data.folders[0].count = count;
  await page.route('**/data/e2etest000001.json', (route) => route.fulfill({ json: data }));
}
async function firstVisiblePlace(page: Page) {
  return page.getByTestId('view-scroll').evaluate((host) => {
    const bounds = host.getBoundingClientRect();
    const first = [...host.querySelectorAll<HTMLElement>('[data-place-key]')].find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > bounds.top + 1 && rect.top < bounds.bottom - 1;
    });
    if (!first) throw new Error('visible place missing');
    return { key: first.dataset.placeKey!, top: first.getBoundingClientRect().top - bounds.top };
  });
}
async function nextTwoFrames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test('가상 복원 desktop 확정 열 이전에 임시 renderer가 cache를 덮어쓰지 않는다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await useVirtualFixture(page);
  await openTrip(page, `${TRIP_PATH}?view=places`);
  const host = page.getByTestId('view-scroll');
  const columns = Number(
    await page.locator('[data-place-columns]').getAttribute('data-place-columns'),
  );
  expect(columns).toBeGreaterThan(2);
  await host.evaluate((node) => {
    node.scrollTop = node.scrollHeight * 0.55;
  });
  await nextTwoFrames(page);
  const before = await host.evaluate((node) => node.scrollTop),
    anchor = await firstVisiblePlace(page);
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await page.evaluate(() => {
    const seen: number[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const found = [
            ...(node.matches('[data-place-columns]') ? [node] : []),
            ...node.querySelectorAll('[data-place-columns]'),
          ];
          for (const row of found) seen.push(Number(row.getAttribute('data-place-columns')));
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    Object.assign(window, { __virtualMountAudit: { seen, observer } });
  });
  await page.getByRole('button', { name: '장소', exact: true }).click();
  await expect
    .poll(async () => Math.abs((await host.evaluate((node) => node.scrollTop)) - before))
    .toBeLessThan(3);
  const after = await firstVisiblePlace(page);
  expect(after.key).toBe(anchor.key);
  expect(Math.abs(after.top - anchor.top)).toBeLessThan(3);
  const mounted = await page.evaluate(() => {
    const audit = (
      window as unknown as { __virtualMountAudit: { seen: number[]; observer: MutationObserver } }
    ).__virtualMountAudit;
    audit.observer.disconnect();
    return audit.seen;
  });
  expect(mounted.length).toBeGreaterThan(0);
  expect(mounted.every((value) => value === columns)).toBe(true);
});

test('정적60 활성 메모 저장은 바닥 위치를 초기화하지 않고 왕복 cache도 최신이다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useVirtualFixture(page, 60);
  await openTrip(page, `${TRIP_PATH}?view=places`);
  await page.getByRole('button', { name: '목록', exact: true }).click();
  const host = page.getByTestId('view-scroll');
  await host.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const cell = page.locator('[data-place-key="n:1060"]');
  await expect(cell).toBeInViewport();
  const before = await host.evaluate((node) => node.scrollTop);
  await cell.getByRole('button', { name: '회귀 장소 060 상세', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '장소 상세' });
  await dialog.getByRole('button', { name: '메모 추가', exact: true }).click();
  await dialog.getByLabel('내 메모', { exact: true }).fill('저장 후에도 현재 목록 위치 유지');
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await submitNickname(page, '여행자');
  await expect(dialog.getByText('저장 후에도 현재 목록 위치 유지', { exact: true })).toBeVisible();
  expect(await host.evaluate((node) => node.scrollTop)).toBeCloseTo(before, 0);
  await closeDetail(page);
  await expect(cell).toBeInViewport();
  expect(await host.evaluate((node) => node.scrollTop)).toBeCloseTo(before, 0);
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await page.getByRole('button', { name: '장소', exact: true }).click();
  await expect
    .poll(async () => Math.abs((await host.evaluate((node) => node.scrollTop)) - before))
    .toBeLessThan(2);
  await expect(cell).toContainText('저장 후에도 현재 목록 위치 유지');
});

test('가상500 활성 날짜 chip 추가는 높이를 재측정하며 현재 행 맥락과 새 cache를 유지한다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useVirtualFixture(page);
  await openTrip(page, `${TRIP_PATH}?view=places`);
  await page.getByRole('button', { name: '목록', exact: true }).click();
  const host = page.getByTestId('view-scroll');
  await host.evaluate((node) => {
    node.scrollTop = node.scrollHeight * 0.55;
  });
  await nextTwoFrames(page);
  const initial = await firstVisiblePlace(page);
  const cell = page.locator(`[data-place-key="${initial.key}"]`);
  await cell.getByRole('button', { name: /일정에 추가$/ }).scrollIntoViewIfNeeded();
  await nextTwoFrames(page);
  const before = await firstVisiblePlace(page);
  expect(before.key).toBe(initial.key);
  const height = (await cell.boundingBox())!.height;
  await cell.getByRole('button', { name: /일정에 추가$/ }).click();
  await page.getByRole('button', { name: 'Day 2 (11/15)', exact: true }).click();
  await submitNickname(page, '여행자');
  await expect(page.getByRole('dialog', { name: '일정에 추가' })).toBeHidden();
  await expect(cell).toContainText('Day 2');
  await expect.poll(async () => (await cell.boundingBox())!.height).toBeGreaterThan(height);
  await expect.poll(async () => (await firstVisiblePlace(page)).key).toBe(before.key);
  await expect
    .poll(async () => Math.abs((await firstVisiblePlace(page)).top - before.top))
    .toBeLessThan(3);
  const saved = await host.evaluate((node) => node.scrollTop);
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await page.getByRole('button', { name: '장소', exact: true }).click();
  await expect
    .poll(async () => Math.abs((await host.evaluate((node) => node.scrollTop)) - saved))
    .toBeLessThan(3);
  await expect(cell).toContainText('Day 2');
  expect((await cell.boundingBox())!.height).toBeGreaterThan(height);
});

test('가상500 opener가 화면 밖에서 unmount되면 상세 닫기 focus fallback을 유지한다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useVirtualFixture(page);
  await openTrip(page, `${TRIP_PATH}?view=places`);
  const opener = page.getByRole('button', { name: '회귀 장소 001 상세', exact: true });
  await opener.click();
  await expect(page.getByRole('dialog', { name: '장소 상세' })).toBeVisible();
  await page.getByTestId('view-scroll').evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(page.locator('[data-place-key="n:1001"]')).toHaveCount(0);
  await closeDetail(page);
  await expect(
    page
      .getByRole('navigation', { name: '보기 전환' })
      .getByRole('button', { name: '장소', exact: true }),
  ).toBeFocused();
});

test('가상500 content anchor 복원보다 새 marker 요청이 우선하고 오래된 RAF가 되돌리지 않는다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useVirtualFixture(page);
  await openTrip(page, `${TRIP_PATH}?view=places`);
  await page.getByRole('button', { name: '회귀 장소 001 상세', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '장소 상세' });
  await detail.getByRole('button', { name: '메모 추가', exact: true }).click();
  await detail.getByLabel('내 메모', { exact: true }).fill('닉네임 등록');
  await detail.getByRole('button', { name: '저장', exact: true }).click();
  await submitNickname(page, '여행자');
  await closeDetail(page);
  await page.getByRole('button', { name: '지도', exact: true }).click();
  await page.getByTestId('marker-n:1300').click();
  await closeDetail(page);
  const middle = page.locator('[data-place-key="n:1300"]');
  await expect(middle).toBeInViewport();
  await middle.getByRole('button', { name: '회귀 장소 300 일정에 추가', exact: true }).click();
  await page.getByRole('button', { name: 'Day 2 (11/15)', exact: true }).evaluate((button) => {
    (button as HTMLButtonElement).click();
    const marker = document.querySelector<HTMLButtonElement>('[data-testid="marker-n:1500"]');
    if (!marker) throw new Error('last marker missing');
    marker.click();
  });
  await expect(page.getByRole('dialog', { name: '장소 상세' })).toBeVisible();
  await closeDetail(page);
  await expect(page.locator('[data-place-key="n:1500"]')).toBeInViewport();
  await nextTwoFrames(page);
  await expect(page.locator('[data-place-key="n:1500"]')).toBeInViewport();
  expect((await firstVisiblePlace(page)).key).not.toBe('n:1300');
});

test('가상 목록 바닥의 content 축소는 복원을 끝내고 이후 사용자 스크롤을 유지한다', async ({
  page,
  browserName,
}) => {
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const pending = new Set<number>();
    window.requestAnimationFrame = (callback) => {
      const id = request((time) => {
        pending.delete(id);
        callback(time);
      });
      pending.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      pending.delete(id);
      cancel(id);
    };
    Object.assign(window, { __placeFrames: { pending } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await useVirtualFixture(page, 61);
  await openTrip(page, `${TRIP_PATH}?view=places`);
  await page.getByRole('button', { name: '목록', exact: true }).click();
  const host = page.getByTestId('view-scroll');
  await host.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const last = page.locator('[data-place-key="n:1061"]');
  await expect(last).toBeInViewport();
  await last.getByRole('button', { name: /일정에 추가$/ }).click();
  await page.getByRole('button', { name: 'Day 2 (11/15)', exact: true }).click();
  await submitNickname(page, '여행자');
  await expect(last).toContainText('Day 2');
  await host.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await nextTwoFrames(page);
  const expandedHeight = (await last.boundingBox())!.height;
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await page.getByRole('tab', { name: 'Day 2', exact: true }).click();
  await page
    .getByRole('region', { name: 'Day 2 (11/15)', exact: true })
    .getByRole('button', { name: '원본 일정으로 되돌리기' })
    .click();
  await page.getByRole('button', { name: '장소', exact: true }).click();
  await expect(last).not.toContainText('Day 2');
  await expect.poll(async () => (await last.boundingBox())!.height).toBeLessThan(expandedHeight);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __placeFrames: { pending: Set<number> } }).__placeFrames.pending
            .size,
      ),
    )
    .toBe(0);
  const bottom = await host.evaluate((node) => node.scrollTop);
  if (browserName === 'webkit') {
    await last.getByRole('button', { name: /상세$/ }).focus();
    await page.keyboard.press('PageUp');
  } else {
    await host.hover();
    await page.mouse.wheel(0, -200);
  }
  await expect.poll(async () => host.evaluate((node) => node.scrollTop)).toBeLessThan(bottom - 100);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __placeFrames: { pending: Set<number> } }).__placeFrames.pending
            .size,
      ),
    )
    .toBe(0);
  const away = await host.evaluate(
    (node) =>
      new Promise<number>((resolve) => {
        let previous = node.scrollTop;
        let stable = 0;
        const sample = () => {
          const current = node.scrollTop;
          stable = current === previous ? stable + 1 : 0;
          previous = current;
          if (stable >= 12) resolve(current);
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  expect(away).toBeLessThan(bottom - 100);
  await nextTwoFrames(page);
  await expect
    .poll(async () => Math.abs((await host.evaluate((node) => node.scrollTop)) - away))
    .toBeLessThan(1);
  const deviation = await host.evaluate(
    (node, offset) =>
      new Promise<number>((resolve) => {
        const end = performance.now() + 250;
        let maximum = 0;
        const sample = (time: number) => {
          maximum = Math.max(maximum, Math.abs(node.scrollTop - offset));
          if (time >= end) {
            resolve(maximum);
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
    away,
  );
  expect(deviation).toBeLessThan(1);
});

test('새 일정 호스트는 0에서 시작하고 사용자 스크롤은 뷰 왕복 후 복원된다', async ({
  page,
  browserName,
}) => {
  const data = JSON.parse(await readFile(E2E_FIXTURE_FILE, 'utf8'));
  data.days[0].stops = Array.from({ length: 50 }, (_, index) => ({
    id: `restoreday${String(index).padStart(3, '0')}`,
    placeKey: `n:${1001 + (index % 42)}`,
  }));
  const originalLeg = data.days[0].legs[0];
  data.days[0].legs = data.days[0].stops
    .slice(0, -1)
    .map((stop: { id: string; placeKey: string }, index: number) => {
      const next = data.days[0].stops[index + 1];
      return {
        ...originalLeg,
        fromStopId: stop.id,
        toStopId: next.id,
        fromPlaceKey: stop.placeKey,
        toPlaceKey: next.placeKey,
        status: 'failed',
        distanceKind: 'straight',
        durationMs: null,
        staticDurationMs: null,
        tollFare: null,
        queriedAt: null,
        path: [
          [data.places[stop.placeKey].lng, data.places[stop.placeKey].lat],
          [data.places[next.placeKey].lng, data.places[next.placeKey].lat],
        ],
      };
    });
  await page.route(`**/data/${E2E_PUBLIC_ID}.json`, (route) => route.fulfill({ json: data }));
  await openTrip(page, `${TRIP_PATH}?view=day`);
  const host = page.getByTestId('view-scroll');
  await expect(page.getByTestId('itinerary-panel')).toBeVisible();
  await expect.poll(async () => host.evaluate((node) => node.scrollTop)).toBe(0);
  const previous = await host.elementHandle();
  if (browserName === 'webkit') {
    await host.getByRole('button').first().focus();
    await page.keyboard.press('PageDown');
  } else {
    await host.hover();
    await page.mouse.wheel(0, 500);
  }
  await expect.poll(async () => host.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await host.evaluate(
    (node) =>
      new Promise<void>((resolve) => {
        let previous = node.scrollTop;
        let stable = 0;
        const settle = () => {
          const current = node.scrollTop;
          stable = Math.abs(current - previous) < 0.5 ? stable + 1 : 0;
          previous = current;
          if (stable >= 12) resolve();
          else requestAnimationFrame(settle);
        };
        requestAnimationFrame(settle);
      }),
  );
  const offset = await host.evaluate((node) => node.scrollTop);
  await page.getByRole('button', { name: '장소', exact: true }).click();
  await expect(page.getByTestId('places-panel')).toBeVisible();
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page.getByTestId('itinerary-panel')).toBeVisible();
  expect(await previous!.evaluate((node) => node.isConnected)).toBe(false);
  await expect
    .poll(async () => Math.abs((await host.evaluate((node) => node.scrollTop)) - offset))
    .toBeLessThan(2);
});

async function settlePlaceGeometry(page: Page) {
  await page.getByTestId('view-scroll').evaluate(
    (host) =>
      new Promise<void>((resolve) => {
        let previous = '',
          stable = 0;
        const settle = () => {
          const list = host.querySelector<HTMLElement>('[data-place-count]');
          const row = list?.querySelector<HTMLElement>('[data-index]');
          const ruler = list?.querySelector<HTMLElement>('[aria-hidden]');
          if (!list || !row || !ruler) {
            requestAnimationFrame(settle);
            return;
          }
          const style = getComputedStyle(row);
          const tracks = style.gridTemplateColumns.split(' ').map(Number.parseFloat);
          const covered =
            tracks.reduce((sum, value) => sum + value, 0) +
            (tracks.length - 1) * parseFloat(style.columnGap);
          const rulerStyle = getComputedStyle(ruler);
          const rulerTracks = rulerStyle.gridTemplateColumns.split(' ').map(Number.parseFloat);
          const rulerCovered =
            rulerTracks.reduce((sum, value) => sum + value, 0) +
            (rulerTracks.length - 1) * parseFloat(rulerStyle.columnGap);
          const signature = [
            host.scrollTop,
            list.clientWidth,
            style.gridTemplateColumns,
            row.dataset.index,
          ].join(':');
          stable =
            tracks.length === rulerTracks.length &&
            tracks.every(
              (track, index) =>
                Number.isFinite(track) && Math.abs(track - rulerTracks[index]!) <= 1,
            ) &&
            Math.abs(parseFloat(style.columnGap) - parseFloat(rulerStyle.columnGap)) <= 1 &&
            Math.abs(covered - rulerCovered) <= 1 &&
            covered <= ruler.clientWidth + 1 &&
            signature === previous
              ? stable + 1
              : 0;
          previous = signature;
          if (stable >= 12) resolve();
          else requestAnimationFrame(settle);
        };
        requestAnimationFrame(settle);
      }),
  );
}
for (const inFlight of [false, true]) {
  test(`가상 geometry ${inFlight ? '전환 중' : '안정 후'} 실제 입력은 이전390 cache로 돌아가지 않는다`, async ({
    page,
    browserName,
    browser,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await useVirtualFixture(page);
    await openTrip(page, `${TRIP_PATH}?view=places`);
    const host = page.getByTestId('view-scroll');
    await host.evaluate((node) => {
      const inputs: { type: string; trusted: boolean; top: number; time: number }[] = [];
      Object.assign(window, { __geometryInputs: inputs });
      for (const type of ['keydown', 'wheel'])
        document.addEventListener(type, (event) => {
          inputs.push({
            type,
            trusted: event.isTrusted,
            top:
              document
                .querySelector<HTMLElement>('[data-place-count]')
                ?.closest<HTMLElement>('[data-testid="view-scroll"]')?.scrollTop ?? node.scrollTop,
            time: performance.now(),
          });
        });
    });
    await settlePlaceGeometry(page);
    await host.evaluate((node) => {
      node.scrollTop = node.scrollHeight / 2;
    });
    await settlePlaceGeometry(page);
    const old = await host.evaluate((node) => node.scrollTop);
    expect(old).toBeGreaterThan(10000);
    await page.getByRole('button', { name: '일정', exact: true }).click();
    await page.getByRole('button', { name: '장소', exact: true }).click();
    await settlePlaceGeometry(page);
    await expect
      .poll(async () => Math.abs((await host.evaluate((node) => node.scrollTop)) - old))
      .toBeLessThan(3);
    await page.setViewportSize({ width: 320, height: 844 });
    await settlePlaceGeometry(page);
    await expect.poll(async () => host.evaluate((node) => node.scrollTop)).toBe(0);
    const input = async () => {
      if (browserName === 'webkit') {
        await host.getByRole('button').first().focus();
        await page.keyboard.press('PageDown');
      } else {
        await host.hover();
        await page.mouse.wheel(0, 500);
      }
    };
    await input();
    await expect.poll(async () => host.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await settlePlaceGeometry(page);
    await page.setViewportSize({ width: 390, height: 844 });
    if (inFlight) await input();
    await settlePlaceGeometry(page);
    expect(await host.evaluate((node) => node.scrollTop)).toBeLessThan(old / 2);
    const before = await host.evaluate((node) => node.scrollTop);
    await input();
    await expect.poll(async () => host.evaluate((node) => node.scrollTop)).toBeGreaterThan(before);
    await settlePlaceGeometry(page);
    expect(await host.evaluate((node) => node.scrollTop)).toBeLessThan(old / 2);
    const inputs = await page.evaluate(
      () =>
        (
          window as unknown as {
            __geometryInputs: { type: string; trusted: boolean; top: number; time: number }[];
          }
        ).__geometryInputs,
    );
    expect(
      inputs.filter(
        (event) => event.trusted && event.type === (browserName === 'webkit' ? 'keydown' : 'wheel'),
      ).length,
    ).toBeGreaterThanOrEqual(inFlight ? 3 : 2);
    await testInfo.attach('geometry-native-input', {
      body: JSON.stringify({
        browserName,
        version: browser.version(),
        input: browserName === 'webkit' ? 'keyboard PageDown' : 'mouse wheel500',
        inFlight,
        inputs,
        old,
        before,
        after: await host.evaluate((node) => node.scrollTop),
      }),
      contentType: 'application/json',
    });
  });
}
