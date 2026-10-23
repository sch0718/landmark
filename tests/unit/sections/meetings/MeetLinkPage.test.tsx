import { act, cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeetLinkPage } from 'src/sections/meetings/MeetLinkPage';
import type { MeetDoc, readMeetHash } from 'src/domain/meeting/link';

const read = vi.hoisted(() => vi.fn());
vi.mock('src/domain/meeting/link', async (original) => ({
  ...(await original<typeof import('src/domain/meeting/link')>()),
  readMeetHash: read,
}));
vi.mock('src/sections/meetings/InviteView', () => ({
  InviteView: ({ doc }: { doc: { title: string } }) => <h1>{doc.title}</h1>,
}));
vi.mock('src/sections/meetings/ReplyImport', () => ({ ReplyImport: () => <h1>답장 미리보기</h1> }));
vi.mock('src/sections/meetings/FinalView', () => ({ FinalView: () => <h1>확정 장소</h1> }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  read.mockReset();
});
async function setup(hash: string) {
  const router = createMemoryRouter([{ path: '/meet', element: <MeetLinkPage /> }], {
    initialEntries: [`/meet${hash}`],
  });
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  return router;
}
describe('받은 약속 링크', () => {
  it.each(['d', 'r', 'f'])('문서 %s의 화면으로 보내고 해시는 보존한다', async (kind) => {
    read.mockResolvedValue({ ok: true, doc: { kind, title: '친구 화면' } });
    const router = await setup(`#${kind}=data`);
    expect(
      screen.getByRole('heading', {
        name: kind === 'd' ? '친구 화면' : kind === 'r' ? '답장 미리보기' : '확정 장소',
      }),
    ).toBeInTheDocument();
    expect(router.state.location.hash).toBe(`#${kind}=data`);
  });
  it('깨진 링크는 같은 안내와 목록 단추를 보이고 원인은 콘솔에만 남긴다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    read.mockResolvedValue({ ok: false, reason: 'corrupt' });
    await setup('#d=bad');
    expect(screen.getByRole('alert')).toHaveTextContent('링크를 읽지 못했어요');
    expect(screen.getByRole('link', { name: '약속 목록으로' })).toHaveAttribute(
      'href',
      '/meetings',
    );
    expect(warn).toHaveBeenCalledWith('약속 링크를 읽지 못했어요', 'corrupt');
  });
  it('해시를 바꾼 뒤 늦게 풀린 이전 링크는 표시하지 않는다', async () => {
    let finish!: (value: Awaited<ReturnType<typeof readMeetHash>>) => void;
    read
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce({ ok: true, doc: { kind: 'f' } });
    const router = await setup('#d=old');
    await act(async () => {
      await router.navigate('/meet#f=new');
    });
    await act(async () => {
      finish({ ok: true, doc: { kind: 'd', title: '늦은 화면' } as MeetDoc });
    });
    expect(screen.getByRole('heading', { name: '확정 장소' })).toBeInTheDocument();
    expect(screen.queryByText('늦은 화면')).not.toBeInTheDocument();
  });
});
