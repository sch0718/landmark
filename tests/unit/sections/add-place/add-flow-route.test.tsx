import { act, cleanup, render } from '@testing-library/react';
import { atom, createStore, Provider, useAtomValue } from 'jotai';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAddFlowRoute } from 'src/sections/add-place/AddPlaceHost';
import { addFlowAtom } from 'src/stores/add-place';
import { mockViewport } from '../shell/harness';

// 이동이 끝나지 않은(기록이 아직 그대로인) 때를 만들려고 `navigate`만 가짜로 바꾼다.
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigate,
}));

afterEach(() => {
  cleanup();
  navigate.mockClear();
  vi.unstubAllGlobals();
});

const mapShownAtom = atom(false);

function Probe() {
  useAddFlowRoute(useAtomValue(mapShownAtom));
  return null;
}

describe('useAddFlowRoute', () => {
  it('지도로 옮기는 이동이 끝나기 전에 효과가 다시 돌아도 한 번만 옮긴다(뒤로 두 번 가지 않게)', () => {
    mockViewport(390);
    const store = createStore();
    store.set(addFlowAtom, { step: 'pin', name: '', start: null });
    const router = createMemoryRouter([{ path: '*', element: <Probe /> }], {
      initialEntries: [
        {
          pathname: '/place/place00001',
          state: { sheet: { from: 'map', snap: 'half', inApp: true } },
        },
      ],
    });
    render(
      <Provider store={store}>
        <RouterProvider router={router} />
      </Provider>,
    );
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenLastCalledWith(-1);
    // 경로가 바뀌기 전에 지도가 잠깐 보였다가 다시 가려져 효과가 다시 돈다.
    act(() => store.set(mapShownAtom, true));
    act(() => store.set(mapShownAtom, false));
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
