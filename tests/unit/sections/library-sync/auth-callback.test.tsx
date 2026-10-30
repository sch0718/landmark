import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import AuthCallbackPage from 'src/sections/library-sync/AuthCallbackPage';
const mock = vi.hoisted(() => ({ finish: vi.fn() }));
vi.mock('src/services/library-sync/login', () => ({
  finishSocialLogin: mock.finish,
  deviceLabel: () => '시험 기기',
}));
vi.mock('src/services/library-sync/config', () => ({
  readSyncClientConfig: () => ({ apiBase: 'http://localhost/api/sync' }),
}));
vi.mock('src/services/library-sync/api', () => ({ createSyncApi: () => ({}) }));
const replace = vi.fn();
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('location', {
    origin: 'http://localhost',
    href: 'http://localhost/auth/callback',
    replace,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const show = () =>
  render(
    <MemoryRouter initialEntries={['/auth/callback']}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/settings" element={<div>설정 도착</div>} />
      </Routes>
    </MemoryRouter>,
  );
it.each(['choose', 'resume'])(
  '성공(%s)하면 전체 문서를 다시 열어 리퍼러 정책을 초기화한다',
  async (next) => {
    mock.finish.mockResolvedValue({ ok: true, provider: 'kakao', next });
    localStorage.setItem('tripmap:sync-return', '/trips');
    show();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/trips'));
    expect(localStorage.getItem('tripmap:sync-return')).toBeNull();
  },
);
it.each([null, '//evil.example', 'https://evil.example'])(
  '안전하지 않거나 없는 복귀 주소 %s는 설정 문서를 연다',
  async (target) => {
    mock.finish.mockResolvedValue({ ok: true, provider: 'kakao', next: 'choose' });
    if (target) localStorage.setItem('tripmap:sync-return', target);
    show();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/settings#sync'));
  },
);
it('오류 화면의 설정 링크도 SPA 이동을 가로채지 않는다', async () => {
  mock.finish.mockResolvedValue({ ok: false, reason: 'cancelled' });
  show();
  const link = await screen.findByRole('link', { name: '설정으로 돌아가기' });
  expect(link).toHaveAttribute('href', '/settings#sync');
  let intercepted: boolean | undefined;
  const observe = (event: Event) => {
    intercepted = event.defaultPrevented;
    event.preventDefault(); // jsdom의 실제 문서 이동만 막는다.
  };
  document.addEventListener('click', observe, { once: true });
  fireEvent.click(link);
  expect(intercepted).toBe(false);
});
it('허용 밖 계정과 복사 단추를 보인다', async () => {
  mock.finish.mockResolvedValue({
    ok: false,
    reason: 'not-allowed',
    account: 'kakao:dev-stranger',
  });
  show();
  expect(await screen.findByText('kakao:dev-stranger')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '복사' })).toBeInTheDocument();
});
it('다른 브라우저 콜백을 안내한다', async () => {
  mock.finish.mockResolvedValue({ ok: false, reason: 'mismatch' });
  show();
  expect(await screen.findByText(/이 브라우저에서 시작한 로그인이/)).toBeInTheDocument();
});
