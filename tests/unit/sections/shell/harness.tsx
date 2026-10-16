import { act, render } from '@testing-library/react';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { createStore, Provider } from 'jotai';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { SHARE_DATA_PLACEHOLDER } from 'src/domain/share/inject';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { PANEL_CHUNKS, ROUTE_CHUNKS } from 'src/routes/lazy-routes';
import { routes } from 'src/routes/router';
import { BackupMetaStore } from 'src/services/backup-meta-store';
import { IdGen } from 'src/services/id-gen';
import { LegacyTripSource } from 'src/services/legacy-trip-source';
import { PlaceLookupError, RouteLookupError } from 'src/services/errors';
import { LibraryStore } from 'src/services/library-store';
import { PlaceLookup } from 'src/services/place-lookup';
import { PrefsStore } from 'src/services/prefs-store';
import { Geolocation } from 'src/services/geolocation';
import { ReverseGeocoder } from 'src/services/reverse-geocoder';
import { RouteLookup } from 'src/services/route-lookup';
import { ShareTemplate } from 'src/services/share-template';
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

/** 테스트 기본 공유 틀: 데이터 자리 문자열이 정확히 하나. */
const DEFAULT_SHARE_TEMPLATE = `<!doctype html><script type="application/json" id="tripmap-share">${SHARE_DATA_PLACEHOLDER}</script>`;

/** 테스트 기본 장소 조회: 서버 없이 연결 실패(`OFFLINE`)만 돌려준다. 콘솔 경고도 내지 않는다. */
const OFFLINE_PLACE_LOOKUP = Layer.succeed(
  PlaceLookup,
  PlaceLookup.of({
    lookupLink: () => Effect.fail(new PlaceLookupError({ code: 'OFFLINE' })),
    lookupFolder: () => Effect.fail(new PlaceLookupError({ code: 'OFFLINE' })),
  }),
);

/** 테스트 기본 경로 조회: 서버 없이 연결 실패(`OFFLINE`)만 돌려준다. 콘솔 경고도 내지 않는다. */
const OFFLINE_ROUTE_LOOKUP = Layer.succeed(
  RouteLookup,
  RouteLookup.of({
    leg: () => Effect.fail(new RouteLookupError({ code: 'OFFLINE', seq: 0, fresh: false })),
  }),
);

/** 테스트 기본 주소 변환: 늘 "주소를 못 찾음"(null). */
const NULL_REVERSE_GEOCODER = Layer.succeed(
  ReverseGeocoder,
  ReverseGeocoder.of({ reverse: () => Effect.succeed(null) }),
);

/** 테스트 기본 위치: 위치 API 없음(`unsupported`). */
const UNSUPPORTED_GEOLOCATION = Geolocation.layerWith({ api: undefined, secure: true });

/** 실제 라우트 표를 메모리 라우터로 그린다. 저장소는 `storage`(없으면 메모리 모드). */
export async function renderApp(
  options: {
    path?: string;
    storage?: Storage;
    ids?: string[];
    /**
     * 공유 틀 본문(문자열) 또는 틀 받기 실패(Error). 없으면 자리 문자열이 하나뿐인 최소 틀.
     * 함수면 받을 때마다 불러 결과를 바꿀 수 있다(실패 뒤 재시도 등). Promise를 돌려주면 그때까지 기다린다.
     */
    shareTemplate?: string | Error | (() => string | Error | Promise<string | Error>);
    /** 장소 조회 가짜 레이어. 없으면 늘 `OFFLINE`으로 실패한다. */
    placeLookup?: Layer.Layer<PlaceLookup>;
    /** 경로 조회 가짜 레이어. 없으면 늘 `OFFLINE`으로 실패한다. */
    routeLookup?: Layer.Layer<RouteLookup>;
    /** 주소 변환 가짜 레이어. 없으면 늘 null을 돌려준다. */
    reverseGeocoder?: Layer.Layer<ReverseGeocoder>;
    /** 위치 서비스 레이어. 없으면 위치 API가 없는 것(`unsupported`)으로 둔다. */
    geolocation?: Layer.Layer<Geolocation>;
    /**
     * 화면 파일(여행·설정·라벨·옛 여행 가져오기)을 그리기 전에 미리 받아 둔다(기본 true). 실제 앱의 미리 받기와
     * 같은 효과라 `React.lazy`가 첫 그림에서 바로 풀린다. 받는 동안의 화면이나 받기 실패를 볼 때만 끈다.
     */
    preloadRoutes?: boolean;
    /**
     * 추가 칸 단계·내보내기 대화상자 파일을 그리기 전에 미리 받아 둔다(기본 true). `preloadRoutes`와 같은 뜻이다.
     * 단계를 기다리는 동안의 칸이나 받기 실패를 볼 때만 끈다.
     */
    preloadPanels?: boolean;
  } = {},
) {
  const {
    path = '/',
    storage,
    ids = [],
    shareTemplate = DEFAULT_SHARE_TEMPLATE,
    placeLookup = OFFLINE_PLACE_LOOKUP,
    routeLookup = OFFLINE_ROUTE_LOOKUP,
    reverseGeocoder = NULL_REVERSE_GEOCODER,
    geolocation = UNSUPPORTED_GEOLOCATION,
    preloadRoutes = true,
    preloadPanels = true,
  } = options;
  if (preloadRoutes) await Promise.all(ROUTE_CHUNKS.map((load) => load()));
  if (preloadPanels) await Promise.all(PANEL_CHUNKS.map((load) => load()));
  setAppRuntimeForTest(
    ManagedRuntime.make(
      Layer.mergeAll(
        LibraryStore.layerWith({ storage, events: new EventTarget() }),
        PrefsStore.layerWith({ storage }),
        BackupMetaStore.layerWith({ storage }),
        IdGen.layerSequence(ids),
        LegacyTripSource.layerWith({ storage, fetch: (...args) => globalThis.fetch(...args) }),
        ShareTemplate.layerWith({
          fetch: async () => {
            const body = await (typeof shareTemplate === 'function'
              ? shareTemplate()
              : shareTemplate);
            if (body instanceof Error) throw body;
            return new Response(body);
          },
          url: '/share-viewer.html',
        }),
        placeLookup,
        routeLookup,
        reverseGeocoder,
        geolocation,
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
