import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockRoutes, placeIdByName, seed, seedStorage } from './fixtures';

/** 좁은 화면(하단 시트·네이버 지도 앱 길찾기)인가. 경계는 `use-layout`의 compact(<768)와 같다. */
const isCompact = (page: Page): boolean => page.viewportSize()!.width < 768;

const candidatePanel = (page: Page): Locator =>
  isCompact(page)
    ? page.getByRole('region', { name: '일정 시트' })
    : page.getByRole('region', { name: '후보 칸' });

/** 후보 이름으로 ＋(을/를은 받침으로 갈리므로 정규식으로 잡는다). */
const addButton = (page: Page, name: string): Locator =>
  candidatePanel(page).getByRole('button', {
    name: new RegExp(`^${name}[을를] Day 1에 넣기$`),
  });

/** 정규식에 그대로 넣을 글자(좌표의 `.`). */
const esc = (text: string | number): string => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const card = (page: Page): Locator => page.getByRole('region', { name: '다음 장소' });
const cardTitle = (page: Page): Locator => card(page).getByRole('heading', { level: 2 });

/** 시드의 경포대 좌표(WGS84). */
const GYEONGPODAE = seed.places[placeIdByName('경포대')]!;
const AT_GYEONGPODAE = { latitude: GYEONGPODAE.lat, longitude: GYEONGPODAE.lng, accuracy: 20 };
/** 경포대에서 북쪽으로 약 1km(위도 0.009°). */
const MOVED = { latitude: 37.809, longitude: GYEONGPODAE.lng, accuracy: 20 };

/**
 * 받은 위치의 `timestamp`를 페이지 시계(`Date.now()`)로 바꾼다. 좌표·권한은 브라우저의 위치 흉내 그대로 쓴다.
 * `page.clock`은 페이지의 `Date`만 2026-10-24로 옮기고 위치의 `timestamp`는 실제 시각(WebKit은 µs 단위)이라,
 * 그대로 두면 앱이 위치를 낡았다고(`FIX_FRESH_MS`) 보거나 거꾸로 늘 새것으로 본다.
 */
async function rebaseGeoTimestamps(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const geo = navigator.geolocation;
    const rebase =
      (onFix: PositionCallback): PositionCallback =>
      (position) =>
        onFix({
          coords: position.coords,
          timestamp: Date.now(),
          toJSON: () => ({ coords: position.coords.toJSON(), timestamp: Date.now() }),
        });
    const watch = geo.watchPosition.bind(geo);
    const current = geo.getCurrentPosition.bind(geo);
    geo.watchPosition = (onFix, onError, options) => watch(rebase(onFix), onError, options);
    geo.getCurrentPosition = (onFix, onError, options) => current(rebase(onFix), onError, options);
  });
}

test.describe('여행 당일 모드', () => {
  test('@smoke 여행 목록 → 오늘 일정 → 다녀옴·되돌리기 → 늦음 → 내 위치·길찾기', async ({
    page,
    context,
  }) => {
    // 오늘은 2026-10-24(토) 08:50. 새 여행의 시작일 기본값이 오늘이다.
    await page.clock.install({ time: new Date('2026-10-24T08:50:00+09:00') });
    await rebaseGeoTimestamps(page);
    await mockRoutes(page);
    await seedStorage(page, { prefs: { libraryView: 'list' } });

    // 1. 보관함 지역 칩 `강릉` → 여행 만들기 → 초당순두부·경포대를 Day 1에.
    await page.goto('/');
    await page.getByRole('group', { name: '지역' }).getByRole('button', { name: /^강릉/ }).click();
    await page.getByRole('button', { name: '이 지역으로 여행 만들기' }).click();
    const dialog = page.getByRole('dialog', { name: '새 여행' });
    await expect(dialog.getByLabel('시작일')).toHaveValue('2026-10-24');
    await dialog.getByRole('button', { name: '만들기', exact: true }).click();
    await expect(page).toHaveURL(/\/trips\/[^/]+$/);
    await addButton(page, '초당순두부 본점').click();
    await addButton(page, '경포대').click();
    // 강릉 장소 11곳 중 두 곳이 Day 1로 갔다(저장이 끝난 뒤 목록으로 간다).
    await expect(candidatePanel(page).getByRole('heading', { name: '후보 9' })).toBeVisible();
    // 계획 화면 지도 칸에도 `오늘 일정`이 있다(스펙 §3.2).
    await expect(
      page.getByRole('region', { name: '지도' }).getByRole('link', { name: '오늘 일정' }),
    ).toBeVisible();

    await page.goto('/trips');
    await page.getByRole('link', { name: '‘강릉 여행’ 오늘 일정' }).click();
    await expect(page).toHaveURL(/\/trips\/[^/]+\/today$/);
    await expect(page.getByRole('heading', { level: 1, name: '오늘 일정' })).toBeVisible();

    // 2. 카드는 첫 장소. 다녀옴 → 다음 장소로 바뀌고, 토스트의 되돌리기 → 원래대로.
    await expect(cardTitle(page)).toHaveText('초당순두부 본점');
    await expect(card(page)).toContainText('계획대로');
    await card(page).getByRole('button', { name: '‘초당순두부 본점’ 다녀옴으로 표시' }).click();
    await expect(cardTitle(page)).toHaveText('경포대');
    await page
      .locator('[data-sonner-toast]')
      .filter({ hasText: '‘초당순두부 본점’ 다녀옴으로 표시했어요' })
      .getByRole('button', { name: '되돌리기' })
      .click();
    await expect(cardTitle(page)).toHaveText('초당순두부 본점');

    // 3. 1시간 40분 뒤(10:30): 계획 도착 09:00보다 늦었다.
    await page.clock.fastForward('01:40:00');
    await expect(card(page)).toContainText('늦음');

    // 4. 위치 권한·좌표(경포대)를 주고 화면을 다시 연다. 권한이 있으면 들어오자마자 위치를 켠다.
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(AT_GYEONGPODAE);
    await page.reload();
    await expect(cardTitle(page)).toHaveText('초당순두부 본점');
    await card(page).getByRole('button', { name: '‘초당순두부 본점’ 다녀옴으로 표시' }).click();
    await expect(cardTitle(page)).toHaveText('경포대');
    await expect(card(page)).toContainText('지금 여기');

    // 약 1km 옮기면 지금 여기가 풀리고 직선거리, 길찾기 출발점은 그 좌표.
    await context.setGeolocation(MOVED);
    await expect(card(page)).toContainText('직선 1.0km');
    await expect(card(page)).not.toContainText('지금 여기');
    const route = card(page).getByRole('link', { name: '경포대까지 길찾기' });
    if (isCompact(page)) {
      await expect(route).toHaveAttribute('href', /^nmap:\/\/route\//);
      await expect(route).toHaveAttribute(
        'href',
        new RegExp(`slat=${esc(MOVED.latitude)}&slng=${esc(MOVED.longitude)}&`),
      );
    } else {
      await expect(route).toHaveAttribute(
        'href',
        new RegExp(
          `^https://map\\.naver\\.com/p/directions/${esc(MOVED.longitude)},${esc(MOVED.latitude)},`,
        ),
      );
    }
  });
});
