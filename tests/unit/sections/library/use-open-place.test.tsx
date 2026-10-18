import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sheetStateOf, useOpenPlace, type SheetFrom } from 'src/sections/library/use-open-place';
import { mockViewport } from '../shell/harness';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Opener({ id, from }: { id: string; from: SheetFrom }) {
  const open = useOpenPlace();
  return (
    <button type="button" onClick={() => open(id, from)}>
      {`${from} ${id}`}
    </button>
  );
}

function setup(width: number, path: string) {
  mockViewport(width);
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <>
            <Opener id="place00002" from="map" />
            <Opener id="place00003" from="list" />
          </>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('sheetStateOf', () => {
  it('상태가 없거나 모양이 다르면 링크로 바로 들어온 것으로 본다', () => {
    const direct = { from: 'map', snap: 'half', inApp: false };
    expect(sheetStateOf(null)).toEqual(direct);
    expect(sheetStateOf({ sheet: { from: 'sky', snap: 'half', inApp: true } })).toEqual(direct);
    expect(sheetStateOf({ sheet: { from: 'list', snap: 'full', inApp: true } })).toEqual({
      from: 'list',
      snap: 'full',
      inApp: true,
    });
  });
});

describe('useOpenPlace', () => {
  it('휴대폰 지도에서 처음 열면 반쯤 시트로 기록을 쌓는다', async () => {
    const router = setup(390, '/map');
    await userEvent.click(screen.getByRole('button', { name: 'map place00002' }));
    expect(router.state.location.pathname).toBe('/place/place00002');
    expect(router.state.historyAction).toBe('PUSH');
    expect(router.state.location.state).toEqual({
      sheet: { from: 'map', snap: 'half', inApp: true },
    });
  });

  it('휴대폰 목록에서 처음 열면 다 펼친 시트다', async () => {
    const router = setup(390, '/');
    await userEvent.click(screen.getByRole('button', { name: 'list place00003' }));
    expect(router.state.location.state).toEqual({
      sheet: { from: 'list', snap: 'full', inApp: true },
    });
  });

  it('휴대폰에서 이미 열려 있으면 바꿔치기하고 지금 시트 상태를 그대로 둔다', async () => {
    const router = setup(390, '/map');
    await userEvent.click(screen.getByRole('button', { name: 'map place00002' }));
    await userEvent.click(screen.getByRole('button', { name: 'list place00003' }));
    expect(router.state.location.pathname).toBe('/place/place00003');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(router.state.location.state).toEqual({
      sheet: { from: 'map', snap: 'half', inApp: true },
    });
  });

  it('넓은 화면은 열린 장소가 있어도 기록을 쌓는다', async () => {
    const router = setup(1280, '/place/place00002');
    await userEvent.click(screen.getByRole('button', { name: 'list place00003' }));
    expect(router.state.historyAction).toBe('PUSH');
  });
});
