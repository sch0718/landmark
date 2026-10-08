import { act, render } from '@testing-library/react';
import { Layer, ManagedRuntime } from 'effect';
import { createStore, Provider } from 'jotai';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { routes } from 'src/routes/router';
import { IdGen } from 'src/services/id-gen';
import { LegacyTripSource } from 'src/services/legacy-trip-source';
import { LibraryStore } from 'src/services/library-store';
import { PrefsStore } from 'src/services/prefs-store';
import { ThemeRoot } from 'src/theme/ThemeRoot';

/**
 * `(min-width:Npx)` 질의를 주어진 폭으로 판정하는 `matchMedia`를 깐다. 나머지 질의는 false.
 * 돌려주는 `setWidth`는 폭을 바꾸고 `change` 리스너를 불러 창 크기 조절을 흉내 낸다.
 */
export function mockViewport(initial: number): { setWidth: (width: number) => void } {
  let width = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      const min = /\(min-width:\s*(\d+)px\)/.exec(query);
      return {
        get matches() {
          return min !== null && width >= Number(min[1]);
        },
        media: query,
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      };
    }),
  );
  return {
    setWidth(next) {
      width = next;
      act(() => {
        for (const listener of [...listeners]) listener();
      });
    },
  };
}

/** 실제 라우트 표를 메모리 라우터로 그린다. 저장소는 `storage`(없으면 메모리 모드). */
export async function renderApp(
  options: { path?: string; storage?: Storage; ids?: string[] } = {},
) {
  const { path = '/', storage, ids = [] } = options;
  setAppRuntimeForTest(
    ManagedRuntime.make(
      Layer.mergeAll(
        LibraryStore.layerWith({ storage, events: new EventTarget() }),
        PrefsStore.layerWith({ storage }),
        IdGen.layerSequence(ids),
        LegacyTripSource.layerWith({ storage, fetch: (...args) => globalThis.fetch(...args) }),
      ),
    ),
  );
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const store = createStore();
  await act(async () => {
    render(
      <Provider store={store}>
        <ThemeRoot>
          <RouterProvider router={router} />
        </ThemeRoot>
      </Provider>,
    );
  });
  return { router, store };
}
