import { expect } from '@playwright/test';
import {
  test,
  addButton,
  candidatePanel,
  createGangneungTrip,
  day1Names,
  isCompact,
  mockRoutes,
  openSheetTab,
  timeline,
} from './fixtures';

test.describe('여행 계획', () => {
  test('Day 1에서 다른 Day 점의 설명을 읽고 표시를 켜고 끈다', async ({ page }) => {
    await mockRoutes(page);
    await createGangneungTrip(page);
    await openSheetTab(page, 'candidates');
    await candidatePanel(page).getByRole('button', { name: 'Day 자동 나누기' }).click();
    await candidatePanel(page).getByRole('button', { name: '적용', exact: true }).click();
    await expect(candidatePanel(page).getByRole('heading', { name: '후보 0' })).toBeVisible();
    await openSheetTab(page, 'Day 1');
    if (isCompact(page)) {
      // 시트 높이: 반쯤 → 거의 전체 → 접힘. 지도 마커를 가리지 않게 한다.
      const handle = page.getByRole('button', { name: '시트 높이 바꾸기' });
      await handle.click();
      await handle.click();
      await expect(page.getByRole('region', { name: '일정 시트' })).toHaveAttribute(
        'data-snap',
        'collapsed',
      );
    }
    const map = page.getByRole('region', { name: '지도', exact: true });
    const dots = map.getByRole('button', { name: /^Day 2 · .+/ });
    await expect(dots.first()).toBeVisible();
    await expect(dots.first()).toHaveAttribute('data-shape', 'dot');
    const label = (await dots.first().getAttribute('aria-label'))!;
    await expect(dots.first()).toHaveAttribute('title', label);
    await expect(dots.first()).toHaveText('');
    const count = await dots.count();
    const toggle = map.getByRole('button', { name: '다른 Day 장소', exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const bounds = await toggle.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(dots).toHaveCount(0);
    await expect(map.locator('[data-testid^="marker-"]').first()).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(dots).toHaveCount(count);
  });

  test('@smoke 지역 칩으로 여행을 만들고 Day에 넣으면 시간표가 나온다', async ({ page }) => {
    const calls = await mockRoutes(page);
    await createGangneungTrip(page);

    // 강릉 보관함 장소(11곳)가 모두 후보다.
    await expect(candidatePanel(page).getByRole('heading', { name: '후보 11' })).toBeVisible();

    await addButton(page, '초당순두부 본점').click();
    await addButton(page, '경포대').click();
    await openSheetTab(page, 'Day 1');

    const list = timeline(page).getByRole('list', { name: 'Day 1 일정' });
    // 도착 시각 둘(첫 장소는 출발 시각 09:00)과 그 사이 구간 하나.
    await expect(list.getByText(/^\d{2}:\d{2}$/)).toHaveCount(2);
    await expect(list.getByText('09:00', { exact: true })).toBeVisible();
    const leg = list.getByRole('listitem', { name: /^초당순두부 본점 → 경포대$/ });
    await expect(leg).toHaveCount(1);
    await expect(list.getByRole('listitem', { name: /→/ })).toHaveCount(1);
    // 구간 행: 이동 수단·시간·거리(녹화 응답)와 길찾기 링크.
    await expect(leg.getByText(/\d+(분|초) · [\d.]+k?m/)).toBeVisible();
    const link = leg.getByRole('link', { name: '네이버 지도로 길찾기' });
    const href = (await link.getAttribute('href'))!;
    expect(href).toMatch(
      isCompact(page)
        ? /^nmap:\/\/route\/(car|walk)\?/
        : /^https:\/\/map\.naver\.com\/p\/directions\//,
    );

    // 경로는 서버(/api/route)에 물었다.
    expect(calls.length).toBeGreaterThan(0);
  });

  test('순서 정리로 동선을 줄인다', async ({ page }) => {
    await mockRoutes(page);
    await createGangneungTrip(page);

    // 일부러 멀리 갔다 돌아오는 순서로 넣는다: 초당(128.9,37.79) → 정동진(129.03,37.69) → 경포대(128.9,37.8) → 주문진(128.82,37.89).
    const order = ['초당순두부 본점', '정동진 해변', '경포대', '주문진 수산시장'];
    for (const name of order) await addButton(page, name).click();
    await openSheetTab(page, 'Day 1');
    await expect.poll(() => day1Names(page, order)).toEqual(order);

    await timeline(page).getByRole('button', { name: '순서 정리' }).click();
    await expect(page.getByText('순서를 정리했어요').first()).toBeVisible();
    const sorted = await day1Names(page, order);
    expect(sorted).toHaveLength(4);
    expect(sorted).not.toEqual(order);
    // 정동진은 끝에 가깝다: 경포대·초당·주문진 같은 북쪽 무리와 떨어져 있어 맨 앞이나 맨 뒤로 간다.
    expect([sorted[0], sorted[3]]).toContain('정동진 해변');

    // 되돌리기 토스트로 원래 순서로 돌아간다.
    // (＋로 넣을 때마다 남은 토스트들이 있어 `순서를 정리했어요` 토스트의 버튼을 집는다.)
    await page
      .locator('[data-sonner-toast]')
      .filter({ hasText: '순서를 정리했어요' })
      .getByRole('button', { name: '되돌리기' })
      .click();
    await expect.poll(() => day1Names(page, order)).toEqual(order);

    // 다시 정리하면 같은 결과가 되고, 그 상태에서 한 번 더 누르면 알리기만 한다(순서는 그대로).
    await timeline(page).getByRole('button', { name: '순서 정리' }).click();
    await expect.poll(() => day1Names(page, order)).toEqual(sorted);
    await timeline(page).getByRole('button', { name: '순서 정리' }).click();
    await expect(page.getByText('이미 가장 짧은 순서예요')).toBeVisible();
    expect(await day1Names(page, order)).toEqual(sorted);
  });

  test('Day 자동 나누기를 미리 보고 적용한다', async ({ page }) => {
    await mockRoutes(page);
    await createGangneungTrip(page);
    await openSheetTab(page, 'candidates');

    await candidatePanel(page).getByRole('button', { name: 'Day 자동 나누기' }).click();
    // 미리보기: Day별 곳 수만 보이고 아직 시간표에는 아무것도 없다.
    const summary = candidatePanel(page).getByText(/^Day 1에 \d+곳, Day 2에 \d+곳$/);
    await expect(summary).toBeVisible();
    await expect(
      candidatePanel(page).getByRole('button', { name: '적용', exact: true }),
    ).toBeVisible();
    await expect(candidatePanel(page).getByRole('heading', { name: '후보 11' })).toBeVisible();

    await candidatePanel(page).getByRole('button', { name: '적용', exact: true }).click();
    await expect(page.getByText('Day 자동 나누기를 적용했어요')).toBeVisible();
    // 후보가 모두 Day로 갔다.
    await expect(candidatePanel(page).getByRole('heading', { name: '후보 0' })).toBeVisible();

    await openSheetTab(page, 'Day 1');
    const day1 = await timeline(page)
      .getByRole('list', { name: 'Day 1 일정' })
      .getByRole('listitem')
      .count();
    await openSheetTab(page, 'Day 2');
    if (!isCompact(page)) {
      await page.getByRole('tab', { name: /^Day 2/ }).click();
    }
    const day2 = await timeline(page)
      .getByRole('list', { name: 'Day 2 일정' })
      .getByRole('listitem')
      .count();
    expect(day1).toBeGreaterThan(0);
    expect(day2).toBeGreaterThan(0);
  });
});
