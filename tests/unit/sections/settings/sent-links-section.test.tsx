import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { SentLinksSection } from 'src/sections/settings/SentLinksSection';
import { sentLinks, type SentShortLink } from 'src/services/share-short/store';

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', async (original) => ({
  ...(await original<typeof import('sonner')>()),
  toast: toastMock,
}));

const future = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
const link = (patch: Partial<SentShortLink> = {}): SentShortLink => ({
  id: 'AAAAAAAAAAAAAAAA',
  deleteToken: 'a'.repeat(43),
  title: '강릉 바다',
  kind: 'places',
  createdAt: new Date().toISOString(),
  expiresAt: future(30),
  ...patch,
});

afterEach(() => {
  for (const item of sentLinks.list()) sentLinks.remove(item.id);
  vi.unstubAllGlobals();
  toastMock.mockReset();
  toastMock.error.mockReset();
});

it('보낸 링크가 없으면 칸을 그리지 않는다', () => {
  render(<SentLinksSection />);
  expect(screen.queryByRole('region', { name: '보낸 짧은 링크' })).toBeNull();
});

it('제목·종류·기한을 보이고, 지우면 서버에서 지운 뒤 목록에서 뺀다', async () => {
  sentLinks.add(link());
  sentLinks.add(
    link({ id: 'BBBBBBBBBBBBBBBB', title: '제주 일정', kind: 'trip', deleteToken: 'b'.repeat(43) }),
  );
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<SentLinksSection />);
  const section = screen.getByRole('region', { name: '보낸 짧은 링크' });
  expect(within(section).getByText('제주 일정')).toBeVisible();
  expect(within(section).getByText(/^일정 · .+ 보냄 · .+까지$/)).toBeVisible();
  await userEvent.click(within(section).getByRole('button', { name: '강릉 바다 링크 지우기' }));
  await waitFor(() => expect(within(section).queryByText('강릉 바다')).toBeNull());
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/share/AAAAAAAAAAAAAAAA',
    expect.objectContaining({
      method: 'DELETE',
      headers: { Authorization: `Bearer ${'a'.repeat(43)}` },
    }),
  );
  expect(toastMock).toHaveBeenCalledWith('짧은 링크를 지웠어요');
  expect(sentLinks.list().map((item) => item.id)).toEqual(['BBBBBBBBBBBBBBBB']);
});

it('지우지 못하면 목록에 남기고 안내한다', async () => {
  sentLinks.add(link());
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('끊김');
  });
  render(<SentLinksSection />);
  await userEvent.click(screen.getByRole('button', { name: '강릉 바다 링크 지우기' }));
  await waitFor(() =>
    expect(toastMock.error).toHaveBeenCalledWith('인터넷 연결을 확인하고 다시 해 주세요'),
  );
  expect(screen.getByText('강릉 바다')).toBeVisible();
});

it('다른 곳에서 더한 링크도 바로 보인다', () => {
  render(<SentLinksSection />);
  act(() => sentLinks.add(link()));
  expect(screen.getByText('강릉 바다')).toBeVisible();
});
