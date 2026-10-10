import 'leaflet/dist/leaflet.css';
import './styles.css';
import { SHARE_PROTOCOL_VERSION, envelope, parseToMap, type FromMap } from 'src/share-protocol';
import { createShareMap } from './map';

/**
 * 지도 페이지 진입점(GitHub Pages, spec §4.5). 내보낸 파일이 iframe으로 띄우고 `postMessage`로만 주고받는다.
 * 파일은 `file://`이라 출처가 `"null"`이므로 출처로 거르지 않고, `window.parent`에서 온 메시지만
 * `parseToMap`으로 검사해 쓴다. 보낼 때 `targetOrigin`은 `'*'`다(장소 id와 상태만 보낸다).
 */

const DIRECT_OPEN = 'trip-map에서 내보낸 파일 안에서 쓰는 지도예요';

export function startShareMap(win: Window, root: HTMLElement): void {
  if (win.parent === win) {
    // iframe 없이 직접 열었다: 안내만 보이고 지도·타일 요청은 하지 않는다.
    const notice = root.ownerDocument.createElement('p');
    notice.className = 'direct-open';
    notice.textContent = DIRECT_OPEN;
    root.replaceChildren(notice);
    return;
  }

  const parent = win.parent;
  const post = (msg: FromMap) => parent.postMessage(envelope(msg), '*');
  const dark =
    typeof win.matchMedia === 'function' && win.matchMedia('(prefers-color-scheme: dark)').matches;
  const map = createShareMap(root, post, { dark });

  win.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== parent) return;
    const msg = parseToMap(event.data);
    if (msg === null) return;
    switch (msg.kind) {
      case 'init':
        map.init(msg.places);
        break;
      case 'focus':
        map.focus(msg.placeId);
        break;
      case 'filter':
        map.filter(msg.placeIds);
        break;
    }
  });

  post({ kind: 'ready', maxV: SHARE_PROTOCOL_VERSION });
}

// 실제 페이지에서만 시작한다(테스트는 `startShareMap`을 직접 부른다).
const pageRoot = document.getElementById('root');
if (pageRoot !== null) startShareMap(window, pageRoot);
