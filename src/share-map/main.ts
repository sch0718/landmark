import './styles.css';
import { FakeMapAdapter } from 'src/components/map/FakeMapAdapter';
import { onNaverAuthFailure } from 'src/components/map/load-naver-sdk';
import { NaverMapAdapter } from 'src/components/map/NaverMapAdapter';
import { SHARE_PROTOCOL_MAX_VERSION, envelope, parseToMap, type FromMap } from 'src/share-protocol';
import { createShareMap, type ShareMapOptions } from './map';

/**
 * 지도 페이지 진입점(GitHub Pages, spec §4.5). 내보낸 파일이 iframe으로 띄우고 `postMessage`로만 주고받는다.
 * 파일은 `file://`이라 출처가 `"null"`이므로 출처로 거르지 않고, `window.parent`에서 온 메시지만
 * `parseToMap`으로 검사해 쓴다. 보낼 때 `targetOrigin`은 `'*'`다(장소 id와 상태만 보낸다).
 * `ready`는 늘 v1 봉투로 보내고 `maxV`로 v2(`draw`)를 안다고 알린다(파일이 그 값을 보고 고른다).
 *
 * 지도는 앱과 같은 규칙으로 고른다: 빌드 변수 `VITE_MAP_ADAPTER=fake`면 DOM 가짜 지도(e2e),
 * 아니면 `VITE_NAVER_MAP_CLIENT_ID`로 네이버 지도. ID가 비어 있으면 지도를 그릴 수 없으니
 * `ready` 뒤 바로 `tiles-failed`("지도를 쓸 수 없음")를 보낸다.
 */

const DIRECT_OPEN = '랜드마크에서 내보낸 파일 안에서 쓰는 지도예요';

export function startShareMap(win: Window, root: HTMLElement): void {
  if (win.parent === win) {
    // iframe 없이 직접 열었다: 안내만 보이고 지도(SDK) 요청은 하지 않는다.
    const notice = root.ownerDocument.createElement('p');
    notice.className = 'direct-open';
    notice.textContent = DIRECT_OPEN;
    root.replaceChildren(notice);
    return;
  }

  const parent = win.parent;
  const post = (msg: FromMap) => parent.postMessage(envelope(msg), '*');
  const map = chooseMap();
  if (map === null) {
    // 빌드에 클라이언트 ID가 없다: 파일 쪽이 시한을 기다리지 않고 바로 안내를 띄우게 한다.
    post({ kind: 'ready', maxV: SHARE_PROTOCOL_MAX_VERSION });
    post({ kind: 'tiles-failed' });
    return;
  }
  const dark =
    typeof win.matchMedia === 'function' && win.matchMedia('(prefers-color-scheme: dark)').matches;
  const shareMap = createShareMap(root, post, { ...map, dark });

  win.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== parent) return;
    const msg = parseToMap(event.data);
    if (msg === null) return;
    switch (msg.kind) {
      case 'init':
        shareMap.init(msg.places);
        break;
      case 'draw':
        shareMap.draw(msg.pins, msg.lines);
        break;
      case 'focus':
        shareMap.focus(msg.placeId);
        break;
      case 'filter':
        shareMap.filter(msg.placeIds);
        break;
    }
  });

  post({ kind: 'ready', maxV: SHARE_PROTOCOL_MAX_VERSION });
}

/** 빌드 변수로 지도 어댑터를 고른다. 네이버 클라이언트 ID가 없으면 null. */
function chooseMap(): Pick<ShareMapOptions, 'adapter' | 'onAuthFailure'> | null {
  if (import.meta.env.VITE_MAP_ADAPTER === 'fake') return { adapter: new FakeMapAdapter() };
  const clientId = import.meta.env.VITE_NAVER_MAP_CLIENT_ID;
  if (!clientId) return null;
  return { adapter: new NaverMapAdapter(clientId), onAuthFailure: onNaverAuthFailure };
}

// 실제 페이지에서만 시작한다(테스트는 `startShareMap`을 직접 부른다).
const pageRoot = document.getElementById('root');
if (pageRoot !== null) startShareMap(window, pageRoot);
