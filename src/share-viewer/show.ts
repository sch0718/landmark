import type { ShareDoc } from 'src/schema/share';
import { importLink } from './encode';
import { connectMapFrame, shareMapUrl, toMapPlaces, type MapPort } from './map-frame';
import { renderViewer } from './render';
import { renderTripViewer } from './render-trip';
import type { TripTab } from './trip-view';
export function showShareDoc(
  root: HTMLElement,
  doc: ShareDoc,
  opts: { app: string; importValue?: string; initialTab?: TripTab },
): { currentTab(): TripTab | null; stop(): void } {
  const value = opts.importValue;
  let currentTab: () => TripTab | null = () => null;
  let dispose = () => {};
  let stopMap = () => {};
  // 연결 전에 그린 지도 그림(일정 모드의 첫 `draw`)은 기억했다가 연결한 뒤 보낸다.
  const early: { layers: Parameters<MapPort['draw']>[0] | null } = { layers: null };
  let map: MapPort = {
    focus() {},
    filter() {},
    draw(layers) {
      early.layers = layers;
    },
  };
  const port: MapPort = {
    focus: (id) => map.focus(id),
    filter: (ids) => map.filter(ids),
    draw: (layers) => map.draw(layers),
  };
  const app = opts.app;
  let handle: ReturnType<typeof renderViewer>;
  if (doc.version === 2) {
    // 길찾기 링크는 좁은 화면(767px 이하)에서 앱 주소를 쓴다. 폭이 바뀌면 지금 링크도 바꾼다(스펙 §4.4).
    const narrow = window.matchMedia('(max-width: 767px)');
    const trip = renderTripViewer(root, doc, port, {
      app,
      compact: () => narrow.matches,
      initialTab: opts.initialTab,
    });
    // Safari 13 이하는 `addListener`만 있다. 둘 다 없으면 듣지 않는다(링크는 열 때 모양 그대로). 여기서 던지면
    // 보기 화면 전체가 깨지므로 있는지 보고 건다.
    const refresh = () => trip.refreshDirections();
    if (typeof narrow.addEventListener === 'function') narrow.addEventListener('change', refresh);
    else if (typeof narrow.addListener === 'function') narrow.addListener(refresh);
    currentTab = trip.currentTab;
    dispose = () => {
      if (typeof narrow.removeEventListener === 'function')
        narrow.removeEventListener('change', refresh);
      else if (typeof narrow.removeListener === 'function') narrow.removeListener(refresh);
    };
    handle = trip;
  } else {
    handle = renderViewer(root, doc, port, { app });
  }
  // 압축은 비동기라 링크는 먼저 해시 없이 그려 두고, 끝나면 바꾼다. 실패하면 해시 없는 기본 링크(`/import`)를 둔다.
  if (value !== undefined) {
    handle.setImportLink({ kind: 'direct', href: `/import#d=${value}`, sameTab: true });
  } else {
    void importLink(doc, app)
      .then(handle.setImportLink)
      .catch(() => undefined);
  }
  const slot = root.querySelector<HTMLElement>('#map');
  if (slot !== null) {
    map = connectMapFrame(slot, {
      mapUrl: shareMapUrl(import.meta.env.VITE_SHARE_MAP_URL),
      places: toMapPlaces(doc),
      onSelect: (id) => handle.highlight(id),
    });
    const connection = map as MapPort & { stop?(): void };
    stopMap = () => connection.stop?.();
    if (early.layers !== null) map.draw(early.layers);
  }
  return {
    currentTab,
    stop: () => {
      dispose();
      stopMap();
    },
  };
}
