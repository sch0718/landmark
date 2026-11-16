import './styles.css';
import { FakeMapAdapter } from 'src/components/map/FakeMapAdapter';
import { onNaverAuthFailure } from 'src/components/map/load-naver-sdk';
import { onGoogleAuthFailure } from 'src/components/map/load-google-sdk';
import { shareMapProvider, type MapProvider } from 'src/components/map/map-provider';
import { NaverMapAdapter } from 'src/components/map/NaverMapAdapter';
import {
  SHARE_PROTOCOL_MAX_VERSION,
  envelope,
  parseToMap,
  type FromMap,
  type ToMap,
} from 'src/share-protocol';
import { createShareMap, type ShareMap, type ShareMapOptions } from './map';

/**
 * 지도 페이지 진입점(GitHub Pages, spec §4.5). 내보낸 파일이 iframe으로 띄우고 `postMessage`로만 주고받는다.
 * 파일은 `file://`이라 출처가 `"null"`이므로 출처로 거르지 않고, `window.parent`에서 온 메시지만
 * `parseToMap`으로 검사해 쓴다. 보낼 때 `targetOrigin`은 `'*'`다(장소 id와 상태만 보낸다).
 * `ready`는 늘 v1 봉투로 보내고 `maxV`로 v2(`draw`)를 안다고 알린다(파일이 그 값을 보고 고른다).
 *
 * 지도는 앱과 같은 규칙으로 고른다: 빌드 변수 `VITE_MAP_ADAPTER=fake`면 DOM 가짜 지도(e2e),
 * 구글 키가 있으면 첫 장소·핀의 좌표로 네이버·구글을 고르고, 없으면 바로 네이버 지도를 만든다.
 * 네이버 ID가 비어 있으면 지도를 그릴 수 없으니
 * `ready` 뒤 바로 `tiles-failed`("지도를 쓸 수 없음")를 보낸다.
 */

const DIRECT_OPEN = '랜드마크에서 내보낸 파일 안에서 쓰는 지도예요';

type AdapterOptions = Pick<ShareMapOptions, 'adapter' | 'onAuthFailure'>;
type CreateAdapter = (provider: MapProvider) => Promise<AdapterOptions>;

export function startShareMap(
  win: Window,
  root: HTMLElement,
  createAdapter: CreateAdapter = createSelectedAdapter,
): void {
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
  const fake = import.meta.env.VITE_MAP_ADAPTER === 'fake';
  if (!fake && !import.meta.env.VITE_NAVER_MAP_CLIENT_ID) {
    // 빌드에 클라이언트 ID가 없다: 파일 쪽이 시한을 기다리지 않고 바로 안내를 띄우게 한다.
    post({ kind: 'ready', maxV: SHARE_PROTOCOL_MAX_VERSION });
    post({ kind: 'tiles-failed' });
    return;
  }
  const dark =
    typeof win.matchMedia === 'function' && win.matchMedia('(prefers-color-scheme: dark)').matches;
  const deferred = !fake && !!import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  let shareMap: ShareMap | null = deferred
    ? null
    : createShareMap(root, post, {
        ...(fake
          ? { adapter: new FakeMapAdapter() }
          : {
              adapter: new NaverMapAdapter(import.meta.env.VITE_NAVER_MAP_CLIENT_ID!),
              onAuthFailure: onNaverAuthFailure,
            }),
        dark,
      });
  const queue: ToMap[] = [];
  let choosing = false;
  let failed = false;
  const deliver = (msg: ToMap) => {
    if (!shareMap) return;
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
  };

  win.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== parent) return;
    const msg = parseToMap(event.data);
    if (msg === null) return;
    if (failed) return;
    if (shareMap) {
      deliver(msg);
      return;
    }
    queue.push(msg);
    if (choosing || (msg.kind !== 'init' && msg.kind !== 'draw')) return;
    choosing = true;
    const points: [number, number][] = (msg.kind === 'init' ? msg.places : msg.pins).map(
      ({ lng, lat }) => [lng, lat],
    );
    const provider = shareMapProvider(points, import.meta.env.VITE_GOOGLE_MAPS_API_KEY);
    void createAdapter(provider)
      .then((options) => {
        shareMap = createShareMap(root, post, { ...options, dark });
        for (const queued of queue) deliver(queued);
        queue.length = 0;
      })
      .catch(() => {
        failed = true;
        queue.length = 0;
        post({ kind: 'tiles-failed' });
      });
  });

  post({ kind: 'ready', maxV: SHARE_PROTOCOL_MAX_VERSION });
}

/** 구글 어댑터는 지도 페이지에서도 필요할 때만 받는다. */
async function createSelectedAdapter(provider: MapProvider): Promise<AdapterOptions> {
  if (provider === 'google') {
    const { GoogleMapAdapter } = await import('src/components/map/GoogleMapAdapter');
    return {
      adapter: new GoogleMapAdapter(import.meta.env.VITE_GOOGLE_MAPS_API_KEY!),
      onAuthFailure: onGoogleAuthFailure,
    };
  }
  return {
    adapter: new NaverMapAdapter(import.meta.env.VITE_NAVER_MAP_CLIENT_ID!),
    onAuthFailure: onNaverAuthFailure,
  };
}

// 실제 페이지에서만 시작한다(테스트는 `startShareMap`을 직접 부른다).
const pageRoot = document.getElementById('root');
if (pageRoot !== null) startShareMap(window, pageRoot);
