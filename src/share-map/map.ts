import { FOCUS_ZOOM, focusCamera } from 'src/components/map/camera';
import type { MapAdapter, MapCamera, MapPadding } from 'src/components/map/MapAdapter';
import { placeMarker } from 'src/sections/map/markers';
import type { FromMap, MapPlace } from 'src/share-protocol';
import { pastel } from 'src/theme/tokens/pastel';

/**
 * 지도 페이지의 지도(spec §2.4, §4.5). 앱과 같은 `MapAdapter`(실제는 네이버 지도 JS v3, 테스트·e2e는
 * DOM 가짜)에 앱과 같은 장소 이름 알약 마커를 그린다. 사용자 문자열은 마커 라벨이 `textContent`로만 넣는다.
 * 지도 SDK를 받는 동안 온 메시지는 상태로만 남겨 두었다가 지도가 붙은 뒤 반영한다.
 */

/** 장소 하나로 갈 때(처음 1곳, focus) 줌. 처음 맞추기도 이 줌을 넘지 않는다. */
export { FOCUS_ZOOM };

const FIT_PADDING: MapPadding = { top: 40, right: 40, bottom: 40, left: 40 };
const NO_PADDING: MapPadding = { top: 0, right: 0, bottom: 0, left: 0 };

/** 같은 화면인지(실제 SDK가 돌려주는 좌표의 소수점 끝 흔들림은 무시한다, 1e-7도 ≈ 1cm). */
function sameCamera(a: MapCamera | null, b: MapCamera | null): boolean {
  if (a === null || b === null) return false;
  return (
    Math.abs(a.center[0] - b.center[0]) < 1e-7 &&
    Math.abs(a.center[1] - b.center[1]) < 1e-7 &&
    Math.abs(a.zoom - b.zoom) < 1e-6
  );
}

export type ShareMap = {
  init(places: MapPlace[]): void;
  focus(placeId: string | null): void;
  filter(placeIds: string[]): void;
};

export type ShareMapOptions = {
  adapter: MapAdapter;
  dark?: boolean;
  /** 지도가 붙은 뒤에 오는 인증 실패를 구독한다(네이버: `onNaverAuthFailure`). 해제 함수를 돌려준다. */
  onAuthFailure?: (cb: () => void) => () => void;
};

export function createShareMap(
  container: HTMLElement,
  post: (msg: FromMap) => void,
  opts: ShareMapOptions,
): ShareMap {
  const { adapter } = opts;
  const tokens = opts.dark ? pastel.dark : pastel.light;
  const doc = container.ownerDocument;

  // 네이버 SDK의 setSize가 붙인 요소에 px 크기를 인라인으로 쓴다. 크기를 재는 컨테이너와 붙일 요소를 나눠야
  // iframe이 다시 넓어질 때도 측정이 따라간다(앱 MapView와 같은 구조).
  const canvas = doc.createElement('div');
  canvas.className = 'share-map-canvas';
  container.append(canvas);

  let places: MapPlace[] = [];
  let visible: Set<string> | null = null;
  let selectedId: string | null = null;
  let mounted = false;
  let failed = false;
  // 지도가 붙기 전에 받은 카메라 요청: 처음 맞추기('fit') 또는 고른 장소. 나중 것이 앞의 것을 덮는다.
  let pendingCamera: 'fit' | MapPlace | null = null;
  // 숨긴 iframe(display:none)에서 맞추면 컨테이너가 0x0이라 틀린다. 크기가 생기면 한 번 다시 맞춘다.
  let refitPending = false;
  // 처음 맞추기로 만든 화면. iframe 크기가 바뀌어도(넓은↔좁은 배치, 화면 회전) 지도가 이 화면 그대로면
  // 사용자가 손대지 않은 것이니 새 크기로 다시 맞춘다. focus로 장소에 가면 null(고른 화면이 우선).
  let fittedCamera: MapCamera | null = null;
  let lastSize = '';

  const hasSize = () => container.clientWidth > 0 && container.clientHeight > 0;

  const render = () => {
    if (!mounted) return;
    adapter.setMarkers(
      places
        .filter((place) => visible === null || visible.has(place.id))
        .map((place) =>
          placeMarker(
            place,
            place.color === null ? undefined : tokens.label[place.color],
            tokens,
            place.id === selectedId,
          ),
        ),
    );
  };

  const fitAll = () => {
    refitPending = !hasSize();
    const points = places.map((place): [number, number] => [place.lng, place.lat]);
    const first = points[0];
    fittedCamera = null;
    if (first === undefined) return;
    const unique = new Set(points.map(([lng, lat]) => `${lng},${lat}`));
    if (unique.size === 1) {
      adapter.setCamera(focusCamera(first, NO_PADDING));
    } else {
      adapter.fitBounds(points, FIT_PADDING);
      // 몇 미터 떨어진 곳들끼리면 맞추기가 줌 18~19까지 들어간다. 장소로 갈 때 줌을 넘지 않게 한다.
      const fitted = adapter.getCamera();
      if (fitted !== null && fitted.zoom > FOCUS_ZOOM) {
        adapter.setCamera({ center: fitted.center, zoom: FOCUS_ZOOM });
      }
    }
    fittedCamera = adapter.getCamera();
  };

  const goTo = (place: MapPlace) => {
    // 사용자가 고른 화면이 우선이다. 크기가 생겨도 처음 맞추기로 되돌리지 않는다.
    refitPending = false;
    fittedCamera = null;
    adapter.setCamera(focusCamera([place.lng, place.lat], NO_PADDING));
  };

  /** 컨테이너 크기를 지도에 알린다. 크기가 바뀌어 알렸으면 true. */
  const syncSize = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width <= 0 || height <= 0 || `${width}:${height}` === lastSize) return false;
    lastSize = `${width}:${height}`;
    adapter.resize(width, height);
    return true;
  };

  const onResize = () => {
    if (!mounted) return;
    // 크기를 바꾸기 전에 본다. 어댑터 resize는 가운데·줌을 그대로 두므로 맞춘 화면은 그 크기에서만 맞다
    // (실제 네이버 지도, 2026-10-11: 넓은 배치에서 줌 16으로 맞춘 뒤 좁아지면 장소가 화면 밖으로 나갔다).
    const untouched = sameCamera(adapter.getCamera(), fittedCamera);
    const resized = syncSize();
    if (refitPending ? hasSize() : resized && untouched) {
      // 붙을 때·init과 같은 순서: 카메라를 옮긴 뒤 그린다(네이버는 그린 순간 보이는 범위의 마커만 그린다).
      fitAll();
      render();
    }
  };

  let unsubscribeAuth = () => {};
  // 지도를 쓸 수 없음(SDK 로드 실패·시한·인증 실패): 지도를 걷고 파일 쪽 안내를 한 번만 띄운다.
  const fail = () => {
    if (failed) return;
    failed = true;
    mounted = false;
    unsubscribeAuth();
    adapter.destroy();
    post({ kind: 'tiles-failed' });
  };
  if (opts.onAuthFailure !== undefined) {
    unsubscribeAuth = opts.onAuthFailure(fail);
    // 이미 실패한 상태면 구독 중에 바로 불린다. 그때는 받은 해제 함수로 정리한다.
    if (failed) unsubscribeAuth();
  }

  adapter.setClusterStyle({ color: tokens.accent.main, textColor: tokens.accent.contrast });
  // 누른 마커를 강조한다(화면은 옮기지 않는다). 보기 화면은 그 카드만 표시하고 focus를 보내지 않는다.
  adapter.onMarkerClick((id) => {
    if (!places.some((place) => place.id === id)) return;
    selectedId = id;
    render();
    post({ kind: 'select', placeId: id });
  });
  adapter.mount(canvas).then(
    () => {
      if (failed) return;
      mounted = true;
      syncSize();
      const wanted = pendingCamera;
      pendingCamera = null;
      if (wanted === 'fit') fitAll();
      else if (wanted !== null) goTo(wanted);
      // 카메라를 옮긴 뒤에 그린다. 네이버 어댑터는 그리는 순간 보이는 범위의 마커만 그리고 다음 idle에서
      // 다시 그리는데, 붙은 직후의 첫 맞추기 뒤에는 idle이 오지 않아 처음 범위 밖 마커가 빠졌다(2026-10-11 확인).
      render();
    },
    () => fail(),
  );

  const view = doc.defaultView;
  view?.addEventListener('resize', onResize);
  if (view !== null && typeof view.ResizeObserver === 'function') {
    new view.ResizeObserver(onResize).observe(container);
  }

  return {
    init(next) {
      places = next;
      visible = null;
      selectedId = null;
      // 붙은 뒤에도 카메라를 먼저 옮기고 그린다(붙을 때와 같은 순서, 위 mount 처리의 주석 참고).
      if (mounted) fitAll();
      else pendingCamera = 'fit';
      render();
    },
    focus(placeId) {
      const place = placeId === null ? undefined : places.find((p) => p.id === placeId);
      if (place !== undefined) {
        if (mounted) goTo(place);
        else pendingCamera = place;
      }
      selectedId = place === undefined ? null : place.id;
      render();
    },
    filter(placeIds) {
      visible = new Set(placeIds);
      render();
    },
  };
}
