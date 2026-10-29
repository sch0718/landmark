import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
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
afterEach(cleanup);
const show = () =>
  render(
    <MemoryRouter initialEntries={['/auth/callback']}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/settings" element={<div>설정 도착</div>} />
      </Routes>
    </MemoryRouter>,
  );
it('성공하면 설정으로 이동한다', async () => {
  mock.finish.mockResolvedValue({ ok: true, provider: 'kakao', next: 'choose' });
  show();
  expect(await screen.findByText('설정 도착')).toBeInTheDocument();
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
