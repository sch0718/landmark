import { expect, test, type Locator, type Page } from '@playwright/test';
import { isCompact, placeIdByName, seedStorage } from './fixtures';

const marker = (page: Page, name: string): Locator =>
  page.getByTestId(`marker-${placeIdByName(name)}`);
const sheetOf = (page: Page): Locator => page.getByRole('region', { name: '장소 상세' });

/** 시트의 보이는 윗변(px, 창 위에서). 시트는 아래로 옮겨(`translateY`) 반쯤을 만든다. 움직임(200ms)이 있어 `expect.poll`로 읽는다. */
const sheetTop = async (page: Page): Promise<number> => (await sheetOf(page).boundingBox())!.y;
/** 하단 탭 위로 보이는 시트 높이(px). */
const visibleSheetHeight = async (page: Page): Promise<number> => {
  const nav = (await page.getByRole('navigation', { name: '하단 메뉴' }).boundingBox())!;
  return nav.y - (await sheetTop(page));
};

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
    // 반쯤: 윗변이 창 가운데보다 아래이고, 보이는 높이는 반쯤 상한(320px)을 넘지 않는다.
    const half = page.viewportSize()!.height / 2;
    await expect.poll(() => sheetTop(page)).toBeGreaterThan(half);
    await expect.poll(() => visibleSheetHeight(page)).toBeLessThanOrEqual(320.5);

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
    await expect.poll(() => sheetTop(page)).toBeLessThan(half);
    await sheet.getByRole('button', { name: '접기' }).click();
    await expect(sheet.getByRole('button', { name: '펼치기' })).toBeVisible();
    await expect.poll(() => sheetTop(page)).toBeGreaterThan(half);

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
    if (isCompact(page)) await sheet.getByRole('button', { name: '펼치기' }).click();
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
    // 단계는 기록 상태에 남아 휴대폰 시트는 펼친 채 다시 열린다. 잘리지 않고 보이는 라벨 칸을 확인한다.
    const reloaded = sheetOf(page);
    await expect(reloaded.getByRole('button', { name: '이름 수정' })).toContainText('칠성조선소');
    if (isCompact(page)) {
      await expect(reloaded.getByRole('button', { name: '접기' })).toBeVisible();
    }
    await expect(reloaded.getByRole('list', { name: '붙은 라벨' })).toBeVisible();
    await expect(reloaded.getByRole('list', { name: '붙은 라벨' })).toContainText('바다');
  });
});
