import './styles.css';
import { appUrl, importLink } from './encode';
import { connectMapFrame, shareMapUrl, toMapPlaces, type MapPort } from './map-frame';
import { readShareDoc } from './parse';
import { applyTheme, renderBroken, renderViewer } from './render';
import { renderTripViewer } from './render-trip';

/**
 * 보기 화면 진입점: 데이터 읽기 → 화면 그리기 → 지도 iframe 연결.
 * 지도 자리(`#map`)는 `renderViewer`·`renderTripViewer`가 만들므로 화면을 먼저 그리고, 그 자리에 iframe을 붙인다.
 * 그리는 쪽에는 `map`으로 넘겨 주는 포트를 주고, 연결한 뒤 `map`을 실제 포트로 바꾼다
 * (둘 사이는 동기 코드라 사용자 입력이 끼어들 수 없다).
 */

// 레이아웃 CSS가 `#root`를 기준으로 한다. 틀의 본문은 비워 둔다.
const root = document.createElement('div');
root.id = 'root';
document.body.append(root);
applyTheme(document);

const doc = readShareDoc(document);
if (doc === null) {
  renderBroken(root);
} else {
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
  const app = appUrl(import.meta.env.VITE_APP_URL);
  let handle: ReturnType<typeof renderViewer>;
  if (doc.version === 2) {
    // 길찾기 링크는 좁은 화면(767px 이하)에서 앱 주소를 쓴다. 폭이 바뀌면 지금 링크도 바꾼다(스펙 §4.4).
    const narrow = window.matchMedia('(max-width: 767px)');
    const trip = renderTripViewer(root, doc, port, { app, compact: () => narrow.matches });
    narrow.addEventListener('change', () => trip.refreshDirections());
    handle = trip;
  } else {
    handle = renderViewer(root, doc, port, { app });
  }
  // 압축은 비동기라 링크는 먼저 해시 없이 그려 두고, 끝나면 바꾼다. 실패하면 해시 없는 기본 링크(`/import`)를 둔다.
  void importLink(doc, app)
    .then(handle.setImportLink)
    .catch(() => undefined);
  const slot = root.querySelector<HTMLElement>('#map');
  if (slot !== null) {
    map = connectMapFrame(slot, {
      mapUrl: shareMapUrl(import.meta.env.VITE_SHARE_MAP_URL),
      places: toMapPlaces(doc),
      onSelect: (id) => handle.highlight(id),
    });
    if (early.layers !== null) map.draw(early.layers);
  }
}
