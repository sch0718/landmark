import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import type { ShareDocV2 } from '../../src/schema/share';
import { encodeShareHash, hashDoc } from '../../src/share-viewer/encode';
import { test, mockRoutes, seedStorage } from './fixtures';
import { createSyncServer, installSyncServer } from './sync-server';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

const syncSection = (page: Page) => page.getByRole('region', { name: '동기화', exact: true });
async function login(page: Page) {
  await page.goto('/settings');
  await syncSection(page).getByRole('button', { name: '카카오로 로그인' }).click();
  await page.getByRole('textbox', { name: /계정 ID/ }).fill('me');
  await page.getByLabel('정상 로그인', { exact: true }).check();
  await page.getByRole('button', { name: '계속', exact: true }).click();
}

test('@desktop AI 연결로 받은 일정을 가져오고 연결을 철회해요', async ({ page, context }) => {
  test.setTimeout(120000);
  const server = createSyncServer();
  try {
    await installSyncServer(context, server);
    await seedStorage(page, { prefs: { libraryView: 'list' } });
    await mockRoutes(page);
    await login(page);
    await page
      .getByRole('dialog', { name: '연결 방식' })
      .getByRole('button', { name: '올리기', exact: true })
      .click();
    await expect(syncSection(page).getByText('동기화 완료', { exact: true })).toBeVisible({
      timeout: 15000,
    });

    const name = '여행 도우미';
    const agent = page.getByRole('region', { name: 'AI 연결', exact: true });
    await agent.getByRole('button', { name: '새 연결 만들기', exact: true }).click();
    const create = page.getByRole('dialog', { name: '새 AI 연결', exact: true });
    await create.getByRole('textbox', { name: '이름', exact: true }).fill(name);
    await create.getByRole('checkbox', { name: '받은함으로 일정 보내기', exact: true }).check();
    await create.getByRole('button', { name: '만들기', exact: true }).click();
    // 원문을 읽으면 곧바로 창을 닫아 실패 결과물에 남지 않게 해요.
    const token = await create
      .getByRole('textbox', { name: '연결 토큰', exact: true })
      .inputValue();
    await create.getByRole('button', { name: '닫기', exact: true }).click();
    await expect(create).toBeHidden();
    expect(/^lmk_[A-Za-z0-9_-]{43}$/.test(token)).toBe(true);
    expect(
      await page.evaluate(
        (secret) =>
          [localStorage, sessionStorage].every((storage) =>
            Object.values(storage).every((value) => !String(value).includes(secret)),
          ),
        token,
      ),
    ).toBe(true);

    const doc = JSON.parse(
      readFileSync(new URL('../fixtures/agent-trip/doc.json', import.meta.url), 'utf8'),
    ) as ShareDocV2;
    const d = await encodeShareHash(hashDoc(doc));
    const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    const origin = new URL(page.url()).origin;
    const sent = await server.handle(
      new Request(origin + '/api/agent/v1/inbox', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: JSON.stringify({ v: 1, key, d }),
      }),
    );
    expect(sent?.status).toBe(201);

    await page.reload();
    const notice = page.locator('[data-sonner-toast]').filter({ hasText: 'AI가 보낸 일정 1개' });
    await expect(notice).toBeVisible({ timeout: 15000 });
    await notice.getByRole('button', { name: '보기', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'AI가 보낸 일정', exact: true })
      .getByRole('button', { name: `「${doc.title}」 미리보기`, exact: true })
      .click();
    await expect(page.getByText(`AI 연결 「${name}」가 보낸 일정`, { exact: true })).toBeVisible();
    const deleted = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        /\/api\/sync\/v1\/agent\/inbox\//.test(response.url()),
    );
    await page.getByRole('button', { name: '여행 가져오기', exact: true }).click();
    expect((await deleted).status()).toBe(204);
    await expect(page).toHaveURL(/\/trips\//);
    await page
      .getByRole('navigation', { name: /^(사이드|하단) 메뉴$/ })
      .getByRole('link', { name: '설정', exact: true })
      .click();
    await expect(agent.getByText('받은 일정 없음', { exact: true })).toBeVisible();
    await agent.getByRole('button', { name: `「${name}」 철회`, exact: true }).click();
    const revoke = page.getByRole('dialog', {
      name: `「${name}」 연결을 철회할까요?`,
      exact: true,
    });
    await revoke.getByRole('button', { name: '철회', exact: true }).click();
    await expect(revoke).toBeHidden();
    const whoami = await server.handle(
      new Request(origin + '/api/agent/v1/whoami', {
        headers: { Authorization: 'Bearer ' + token },
      }),
    );
    expect(whoami?.status).toBe(401);
  } finally {
    await page.close();
    server.close();
  }
});
