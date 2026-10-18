import { expect, test, type Locator, type Page } from '@playwright/test';
import { placeIdByName, seedStorage } from './fixtures';

const marker = (page: Page, name: string): Locator =>
  page.getByTestId(`marker-${placeIdByName(name)}`);
const sheetOf = (page: Page): Locator => page.getByRole('region', { name: '장소 상세' });

test.describe('휴대폰 상세 시트', { tag: '@mobile' }, () => {
  test('@smoke 지도에서 반쯤 열고, 다른 마커로 바꾸고, 펼치고 접고, 뒤로 한 번에 지도로', async ({
    page,
  }) => {
    await seedStorage(page);
    await page.goto('/map');
    await marker(page, '칠성조선소').click();
    const sheet = sheetOf(page);
    await expect(sheet.getByRole('button', { name: '펼치기' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: '이름 수정' })).toContainText('칠성조선소');
    // 지도와 하단 탭이 그대로 보인다.
    await expect(page.getByTestId('fake-map')).toBeVisible();
    await expect(page.getByRole('navigation', { name: '하단 메뉴' })).toBeVisible();
    const box = await sheet.boundingBox();
    expect(box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);

    // 다른 마커를 누르면 시트 내용만 바뀐다.
    // 반쯤 연 시트가 아래쪽 마커를 가리므로 시트 위에 보이는 마커를 고른다.
    const other = '영금정';
    await marker(page, other).click();
    await expect(sheet.getByRole('button', { name: '이름 수정' })).toContainText(other);

    // 펼치고 접는다.
    await sheet.getByRole('button', { name: '펼치기' }).click();
    await expect(sheet.getByRole('button', { name: '접기' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await sheet.getByRole('button', { name: '접기' }).click();

    // 새로고침해도 같은 장소의 시트가 남는다.
    await page.reload();
    await expect(sheetOf(page).getByRole('button', { name: '이름 수정' })).toContainText(other);

    // 뒤로 가기 한 번이면 지도로 돌아가고 시트가 없다.
    await page.goBack();
    await expect(page).toHaveURL(/\/map$/);
    await expect(sheetOf(page)).toHaveCount(0);
  });
});

// 세 프로젝트(데스크톱·iPhone·Galaxy) 모두에서 도는 시험이라 태그를 달지 않는다.
test.describe('라벨 바꾸기', () => {
  test('@smoke 검색해서 체크하면 상세 라벨 칸에 보이고 새로고침 뒤에도 남는다', async ({
    page,
  }) => {
    await seedStorage(page);
    const id = placeIdByName('칠성조선소');
    await page.goto(`/place/${id}`);
    const sheet = sheetOf(page);
    // 휴대폰에서 바로 들어오면 반쯤 열린 시트라 아래쪽이 잘려 있다. 펼친 뒤에 누른다.
    await expect(sheet.getByRole('button', { name: '이름 수정' })).toContainText('칠성조선소');
    const expand = sheet.getByRole('button', { name: '펼치기' });
    if (await expand.isVisible()) await expand.click();
    await sheet.getByRole('button', { name: '라벨 바꾸기' }).click();
    const picker = page.getByRole('dialog', { name: '라벨 바꾸기' });
    const search = picker.getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' });
    await search.fill('바다');
    const sea = picker
      .getByRole('group', { name: '라벨 목록' })
      .getByRole('checkbox', { name: /^바다/ });
    await sea.click();
    await expect(sea).toBeChecked();
    await picker.getByRole('button', { name: '완료' }).click();
    await expect(picker).toHaveCount(0);
    await expect(sheet.getByRole('list', { name: '붙은 라벨' })).toContainText('바다');

    await page.reload();
    await expect(sheetOf(page).getByRole('list', { name: '붙은 라벨' })).toContainText('바다');
  });
});
