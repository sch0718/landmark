import type { ShareDoc } from 'src/schema/share';
import {
  envelope,
  parseFromMap,
  type MapLine,
  type MapPin,
  type MapPlace,
  type ToMap,
} from 'src/share-protocol';
import { placeIdOfPin } from './trip-view';

/**
 * 보기 화면이 지도에 알리는 창구. 장소 모드는 `focus`·`filter`(v1)만, 일정 모드는 `draw`(v2)를 더 쓴다.
 * `focus`의 id는 장소 모드에서는 장소 id, 일정 모드에서는 핀 id(`start:`·`end:` 접두사 포함)다.
 */
export type MapPort = {
  focus(id: string | null): void;
  filter(ids: string[]): void;
  draw(layers: { pins: MapPin[]; lines: MapLine[] }): void;
};

/**
 * 지도 페이지(GitHub Pages)를 iframe으로 띄우고 `postMessage`로만 주고받는다(spec §2.4, §4.5).
 * 받을 때는 그 iframe 창에서, 지도 주소의 출처로 온 메시지만 보고, 보낼 때도 그 출처를 지정한다.
 */

/** 지도 페이지 기본 주소(GitHub Pages). */
export const DEFAULT_MAP_URL = 'https://sch0718.github.io/landmark/';

/** 빌드 변수(`VITE_SHARE_MAP_URL`)의 지도 주소. 없거나 빈 문자열이면 기본 주소(빈 값은 `new URL`이 던진다). */
export function shareMapUrl(value: string | undefined): string {
  return value || DEFAULT_MAP_URL;
}

/** iframe을 만든 뒤 지도 페이지의 `ready`를 기다리는 시간. */
export const READY_TIMEOUT_MS = 10_000;

const MAP_FAILED = '지도를 불러오지 못했어요. 목록과 네이버 지도 링크는 그대로 쓸 수 있어요';

/** 지도 페이지에 넘길 것만 고른다: 메모·주소·네이버 ID는 보내지 않는다. 색은 첫 라벨(앱 마커와 같은 규칙). */
export function toMapPlaces(doc: ShareDoc): MapPlace[] {
  const colorById = new Map(doc.labels.map((l) => [l.id, l.color]));
  return doc.places.map((place) => {
    const first = place.labelIds.find((id) => colorById.has(id));
    return {
      id: place.id,
      name: place.name,
      lng: place.lng,
      lat: place.lat,
      color: first === undefined ? null : (colorById.get(first) ?? null),
    };
  });
}

export function connectMapFrame(
  host: HTMLElement,
  opts: { mapUrl: string; places: MapPlace[]; onSelect(id: string): void; win?: Window },
): MapPort {
  const win = opts.win ?? window;
  const d = host.ownerDocument;
  const origin = new URL(opts.mapUrl).origin;

  const iframe = d.createElement('iframe');
  iframe.title = '지도';
  iframe.src = opts.mapUrl;
  const notice = d.createElement('p');
  notice.className = 'map-failed';
  notice.textContent = MAP_FAILED;
  notice.hidden = true;
  host.append(iframe, notice);

  let ready = false;
  let tilesFailed = false;
  // 지도 페이지가 아는 가장 높은 규약(`ready.maxV`). ready 전에는 0이다.
  let maxV = 0;
  // 종류별 마지막 focus·filter·draw(부른 순서). ready가 올 때마다 다시 보낸다:
  // ready 전에 부른 것을 늦게 보내고, 지도 페이지가 다시 읽혀도 그린 것·거른 상태·고른 장소를 되살린다.
  const latest: ToMap[] = [];

  // 일정 모드(`draw`를 한 번이라도 부른 경우). 지도 페이지가 v2를 알면 draw로 그리고,
  // 모르면 v1 init(모든 장소)으로 대신해 draw는 보내지 않는다(spec §6.2).
  const tripMode = () => latest.some((m) => m.kind === 'draw');
  const drawing = () => tripMode() && maxV >= 2;

  const postV = (msg: ToMap, v: 1 | 2) =>
    iframe.contentWindow?.postMessage(envelope(msg, v), origin);
  // 보낼 때의 봉투 버전과 내용을 규칙대로 고른다.
  const post = (msg: ToMap) => {
    if (msg.kind === 'draw') {
      if (maxV >= 2) postV(msg, 2);
      return;
    }
    if (drawing()) {
      if (msg.kind === 'focus') postV(msg, 2);
      return; // 일정 모드는 filter를 쓰지 않는다
    }
    if (msg.kind === 'focus' && tripMode() && msg.placeId !== null) {
      postV({ kind: 'focus', placeId: placeIdOfPin(msg.placeId) }, 1);
      return;
    }
    postV(msg, 1);
  };
  const showMap = (show: boolean) => {
    iframe.hidden = !show;
    notice.hidden = show;
  };
  const remember = (msg: ToMap) => {
    // 지도가 끝내 안 뜨는 동안 카드를 여러 번 눌러도 쌓이지 않게, 같은 종류는 마지막 것만 남긴다.
    const same = latest.findIndex((m) => m.kind === msg.kind);
    if (same !== -1) latest.splice(same, 1);
    latest.push(msg);
  };
  const send = (msg: ToMap) => {
    remember(msg);
    if (ready) post(msg);
  };

  const timer = win.setTimeout(() => {
    if (!ready) showMap(false);
  }, READY_TIMEOUT_MS);

  win.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== origin) return;
    const msg = parseFromMap(event.data);
    if (msg === null) return;
    switch (msg.kind) {
      case 'ready':
        // 시한 뒤에 늦게 와도(느린 망) 안내를 걷고 지도를 보인다. 지도 페이지가 다시 읽히면 처음부터 다시 보낸다.
        win.clearTimeout(timer);
        ready = true;
        maxV = msg.maxV;
        if (!tilesFailed) showMap(true);
        if (drawing()) {
          // 마지막 draw, 그다음 마지막 focus(부른 순서와 상관없이).
          for (const kind of ['draw', 'focus'] as const) {
            const replay = latest.find((m) => m.kind === kind);
            if (replay !== undefined) post(replay);
          }
        } else {
          post({ kind: 'init', places: opts.places });
          for (const replay of latest) post(replay);
        }
        break;
      case 'select':
        // 지도는 누른 마커를 이미 강조했다. 보내지 않고, 다시 읽힐 때 되살릴 고른 장소로만 남긴다.
        remember({ kind: 'focus', placeId: msg.placeId });
        opts.onSelect(msg.placeId);
        break;
      case 'tiles-failed':
        tilesFailed = true;
        showMap(false);
        break;
    }
  });

  return {
    focus(id) {
      send({ kind: 'focus', placeId: id });
    },
    filter(ids) {
      send({ kind: 'filter', placeIds: [...ids] });
    },
    draw(layers) {
      send({ kind: 'draw', pins: layers.pins, lines: layers.lines });
    },
  };
}
