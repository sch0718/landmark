import './styles.css';
import { connectMapFrame, toMapPlaces } from './map-frame';
import { readShareDoc } from './parse';
import { applyTheme, renderBroken, renderViewer, type MapPort } from './render';

/**
 * 보기 화면 진입점: 데이터 읽기 → 화면 그리기 → 지도 iframe 연결.
 * 지도 자리(`#map`)는 `renderViewer`가 만들므로 화면을 먼저 그리고, 그 자리에 iframe을 붙인다.
 * `renderViewer`에는 `map`으로 넘겨 주는 포트를 주고, 연결한 뒤 `map`을 실제 포트로 바꾼다
 * (둘 사이는 동기 코드라 사용자 입력이 끼어들 수 없다).
 */

const DEFAULT_MAP_URL = 'https://sch0718.github.io/landmark/';

// 레이아웃 CSS가 `#root`를 기준으로 한다. 틀의 본문은 비워 둔다.
const root = document.createElement('div');
root.id = 'root';
document.body.append(root);
applyTheme(document);

const doc = readShareDoc(document);
if (doc === null) {
  renderBroken(root);
} else {
  let map: MapPort = { focus() {}, filter() {} };
  const handle = renderViewer(root, doc, {
    focus: (placeId) => map.focus(placeId),
    filter: (placeIds) => map.filter(placeIds),
  });
  const slot = root.querySelector<HTMLElement>('#map');
  if (slot !== null) {
    map = connectMapFrame(slot, {
      mapUrl: import.meta.env.VITE_SHARE_MAP_URL ?? DEFAULT_MAP_URL,
      places: toMapPlaces(doc),
      onSelect: (placeId) => handle.highlight(placeId),
    });
  }
}
