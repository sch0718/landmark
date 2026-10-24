import Dialog from '@mui/material/Dialog';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { HelpIntroHost } from 'src/sections/help/HelpIntroHost';
import { helpSeen } from 'src/services/help-seen';

function Location() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}
function intro(path = '/', blocked = false, other = false) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <button>원래 단추</button>
      <Location />
      {other && (
        <Dialog open>
          <p>다른 대화상자</p>
        </Dialog>
      )}
      <HelpIntroHost blocked={blocked} />
    </MemoryRouter>
  );
}

beforeEach(() => helpSeen.reset());

describe('처음 안내 대화상자', () => {
  it('닫으면 안내를 열기 전 단추로 포커스가 돌아간다', async () => {
    const user = userEvent.setup();
    const view = render(intro('/', true));
    const opener = screen.getByRole('button', { name: '원래 단추' });
    opener.focus();
    view.rerender(intro());
    const start = await screen.findByRole('button', { name: '시작하기' });
    expect(screen.getByRole('dialog', { name: '보관함' })).toContainElement(
      document.activeElement as HTMLElement,
    );
    await user.click(start);
    await waitFor(() => expect(opener).toHaveFocus());
  });
  it('시작하기로 닫으면 기록하고 다시 열지 않는다', async () => {
    const user = userEvent.setup();
    const view = render(intro());
    expect(await screen.findByRole('dialog', { name: '보관함' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: '시작하기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(helpSeen.read().has('library')).toBe(true);
    view.unmount();
    render(intro());
    await act(async () => {});
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('다른 창이 닫힌 뒤 같은 화면에서 안내한다', async () => {
    const view = render(intro('/', false, true));
    await act(async () => {});
    expect(screen.queryByRole('dialog', { name: '보관함' })).not.toBeInTheDocument();
    view.rerender(intro());
    expect(await screen.findByRole('dialog', { name: '보관함' })).toBeInTheDocument();
  });
  it('시트가 열려 있으면 기다리고, 제외 경로에서는 띄우지 않는다', async () => {
    const view = render(intro('/', true));
    await act(async () => {});
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    view.rerender(intro('/', false));
    expect(await screen.findByRole('dialog', { name: '보관함' })).toBeInTheDocument();
    view.unmount();
    render(intro('/settings'));
    await act(async () => {});
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('Esc로 닫아도 본 것으로 기록한다', async () => {
    const user = userEvent.setup();
    render(intro());
    await screen.findByRole('button', { name: '시작하기' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(helpSeen.read().has('library')).toBe(true));
  });
  it('바깥을 눌러 닫아도 기록한다', async () => {
    const user = userEvent.setup();
    render(intro());
    await screen.findByRole('button', { name: '시작하기' });
    await user.click(document.querySelector('.MuiDialog-container')!);
    await waitFor(() => expect(helpSeen.read().has('library')).toBe(true));
  });

  it('자세히로 이동하면서 본 것으로 기록한다', async () => {
    const user = userEvent.setup();
    render(intro());
    await user.click(await screen.findByRole('link', { name: '도움말 자세히' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/help/library');
    expect(helpSeen.read().has('library')).toBe(true);
  });
});
