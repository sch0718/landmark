import * as L from 'leaflet';
import { createMarkerLabelElement } from 'src/components/map/marker-label';
import type { FromMap, MapPlace } from 'src/share-protocol';
import { pastel } from 'src/theme/tokens/pastel';

/**
 * 지도 페이지의 Leaflet 지도(spec §2.4, §4.5). OSM 타일 위에 장소 이름 알약 마커를 그린다.
 * 사용자 문자열은 `createMarkerLabelElement`가 `textContent`로만 넣는다.
 * HTML로 들어가는 것은 아래 고정 출처 문구 하나뿐이다(사용자 데이터 아님).
 */

/** 장소 하나로 갈 때(처음 1곳, focus) 줌. */
export const FOCUS_ZOOM = 16;

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const FIT_PADDING: L.PointExpression = [40, 40];
const SELECTED_Z_OFFSET = 1000;

export type ShareMap = {
  init(places: MapPlace[]): void;
  focus(placeId: string | null): void;
  filter(placeIds: string[]): void;
  tileLayer: L.TileLayer;
  /** 테스트·디버깅용으로 드러낸다. */
  map: L.Map;
};

type Entry = { place: MapPlace; marker: L.Marker };

export function createShareMap(
  container: HTMLElement,
  post: (msg: FromMap) => void,
  opts: { dark?: boolean } = {},
): ShareMap {
  const tokens = opts.dark ? pastel.dark : pastel.light;
  const map = L.map(container);
  map.attributionControl.setPrefix(false);
  const tileLayer = L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(
    map,
  );

  // 타일 실패: 처음 화면에서 tileload 없이 tileerror만 나고 load(남은 타일 없음)가 오면 한 번만 알린다.
  let loaded = 0;
  let errors = 0;
  let tilesFailedSent = false;
  tileLayer.on('tileload', () => {
    loaded += 1;
  });
  tileLayer.on('tileerror', () => {
    errors += 1;
  });
  tileLayer.on('load', () => {
    if (tilesFailedSent || loaded !== 0 || errors === 0) return;
    tilesFailedSent = true;
    post({ kind: 'tiles-failed' });
  });

  const entries = new Map<string, Entry>();
  let selectedId: string | null = null;
  let initialPlaces: MapPlace[] = [];
  // 숨긴 iframe(display:none)에서 init을 받으면 컨테이너가 0x0이라 맞추기가 틀린다. 크기가 생기면 한 번 다시 맞춘다.
  let refitPending = false;

  const iconFor = (place: MapPlace, selected: boolean) => {
    const style = place.color
      ? {
          fill: tokens.label[place.color].fill,
          text: tokens.label[place.color].text,
          border: tokens.label[place.color].marker,
        }
      : { fill: tokens.bg.surface, text: tokens.text.primary, border: tokens.border };
    const element = createMarkerLabelElement(place.name, style.fill, {
      selected,
      textColor: style.text,
      borderColor: style.border,
    });
    // 라벨 요소가 왼쪽 위를 좌표에 두고 스스로 절반만큼 옮기므로 iconAnchor는 [0,0].
    return L.divIcon({ html: element, className: '', iconSize: undefined, iconAnchor: [0, 0] });
  };

  const hasSize = () => container.clientWidth > 0 && container.clientHeight > 0;

  const fitInitial = () => {
    refitPending = !hasSize();
    const first = initialPlaces[0];
    if (first === undefined) return;
    const unique = new Set(initialPlaces.map((p) => `${p.lat},${p.lng}`));
    if (unique.size === 1) {
      map.setView([first.lat, first.lng], FOCUS_ZOOM);
    } else {
      // 몇 미터 떨어진 곳들끼리면 맞추기가 줌 18~19까지 들어간다. 장소로 갈 때 줌을 넘지 않게 한다.
      map.fitBounds(L.latLngBounds(initialPlaces.map((p) => [p.lat, p.lng])), {
        padding: FIT_PADDING,
        maxZoom: FOCUS_ZOOM,
      });
    }
  };

  const setSelected = (placeId: string | null) => {
    const prev = selectedId;
    selectedId = placeId;
    for (const id of [prev, placeId]) {
      const entry = id === null ? undefined : entries.get(id);
      if (entry === undefined) continue;
      const selected = id === selectedId;
      entry.marker.setIcon(iconFor(entry.place, selected));
      entry.marker.setZIndexOffset(selected ? SELECTED_Z_OFFSET : 0);
    }
  };

  const view = container.ownerDocument.defaultView;
  view?.addEventListener('resize', () => {
    map.invalidateSize();
    if (refitPending && hasSize()) fitInitial();
  });

  return {
    init(places) {
      for (const { marker } of entries.values()) marker.remove();
      entries.clear();
      selectedId = null;
      for (const place of places) {
        const marker = L.marker([place.lat, place.lng], { icon: iconFor(place, false) });
        // 누른 마커를 강조한다(화면은 옮기지 않는다). 보기 화면은 그 카드만 표시하고 focus를 보내지 않는다.
        marker.on('click', () => {
          setSelected(place.id);
          post({ kind: 'select', placeId: place.id });
        });
        marker.addTo(map);
        entries.set(place.id, { place, marker });
      }
      initialPlaces = places;
      fitInitial();
    },
    focus(placeId) {
      const entry = placeId === null ? undefined : entries.get(placeId);
      if (entry !== undefined) {
        // 사용자가 고른 화면이 우선이다. 크기가 생겨도 처음 맞추기로 되돌리지 않는다.
        refitPending = false;
        map.setView([entry.place.lat, entry.place.lng], FOCUS_ZOOM);
      }
      setSelected(entry === undefined ? null : entry.place.id);
    },
    filter(placeIds) {
      const keep = new Set(placeIds);
      for (const [id, { marker }] of entries) {
        if (keep.has(id)) {
          if (!map.hasLayer(marker)) marker.addTo(map);
        } else {
          marker.remove();
        }
      }
    },
    tileLayer,
    map,
  };
}
