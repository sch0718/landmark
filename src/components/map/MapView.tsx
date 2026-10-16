import Box from '@mui/material/Box';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { fitPoints, focusCamera } from './camera';
import { FakeMapAdapter } from './FakeMapAdapter';
import {
  DEFAULT_CLUSTER_STYLE,
  type Bounds,
  type ClusterStyle,
  type MapAdapter,
  type MapCamera,
  type MapMarker,
  type MapPadding,
  type MapPolyline,
  type MyLocation,
} from './MapAdapter';
import { onNaverAuthFailure } from './load-naver-sdk';
import { MapZoomButtons } from './MapZoomButtons';
import { NaverMapAdapter } from './NaverMapAdapter';
import { isTouchOnly } from './touch-only';
import { useMapSize } from './use-map-size';

export const MAP_UNAVAILABLE_MESSAGE = '지도를 불러오지 못했어요. 도메인 등록을 확인하세요';
export const MAP_MISSING_CLIENT_ID_MESSAGE =
  '지도 키가 설정되지 않았어요. 환경변수 VITE_NAVER_MAP_CLIENT_ID를 확인하세요';

type Props = {
  visible?: boolean;
  padding?: MapPadding;
  onReadyChange?(ready: boolean): void;
  markers: MapMarker[];
  polylines: MapPolyline[];
  /** 클러스터 마커의 색. 없으면 어댑터 기본색. */
  clusterStyle?: ClusterStyle;
  onMarkerClick(id: string): void;
  onBoundsChange?(b: Bounds): void;
  /** 카메라가 바뀔 때마다(영역 변경 알림과 같은 때) 지도 중심 좌표(경도, 위도)를 알린다. */
  onCenterChange?(center: [number, number]): void;
  /** 값이 바뀔 때마다 그 지점으로 지도를 옮긴다(줌 16, padding을 뺀 영역의 가운데). */
  focus?: { point: [number, number]; seq: number } | null;
  onUnavailable(reason: string): void;
  /**
   * 값이 바뀌면(모드 전환·Day 탭 변경 등 마커 집합이 바뀌는 순간) 그때의 마커 전체가 보이게 지도를 맞춘다.
   * 마운트 직후에도 한 번 맞춘다. 같은 값에서 마커만 바뀌는 경우(편집·선택)에는 맞추지 않는다.
   */
  fitKey?: string;
  /** 내 위치 점과 정확도 원. 값(경도·위도·정확도)이 바뀔 때만 어댑터에 알린다. `null`·없음이면 지운다. */
  myLocation?: MyLocation | null;
  /** 지도 오른쪽 위 단추 기둥에서 확대·축소(터치 전용 기기) 아래에 놓을 단추들. */
  controls?: ReactNode;
  /** 단추 기둥을 오른쪽에서 이만큼(px) 더 띄운다. 상세·추가 칸이 지도를 덮을 때 쓴다. */
  controlsRight?: number;
  /** 마커 외에 `fitKey` 맞추기에 더할 점(경도, 위도). 마커가 없어도 이 점들로 맞춘다. */
  extraFitPoints?: [number, number][];
};

const DEFAULT_PADDING: MapPadding = { top: 40, right: 40, bottom: 40, left: 40 };

export function MapView(props: Props) {
  // frameRef: 컨테이너를 100%로 채우며 크기를 잰다. canvasRef: SDK가 마운트되는 요소.
  // 네이버 SDK의 setSize가 마운트 요소에 px 크기를 인라인으로 쓰므로 둘을 분리해야
  // 영역이 다시 넓어질 때도 측정이 따라간다.
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<MapAdapter | null>(null);
  const visible = props.visible ?? true;
  const [activated, setActivated] = useState(visible);
  const [mountedAdapter, setMountedAdapter] = useState<MapAdapter | null>(null);
  // 터치 전용 기기면 SDK 막대를 빼고 ＋/− 버튼을 그린다. 처음 한 번만 보므로 바뀌지 않는다.
  const [touchOnly] = useState(isTouchOnly);
  const cameras = useRef(new Map<string, MapCamera>());
  const fittedKeys = useRef(new Set<string>());
  const displayedKey = useRef<string | null>(null);
  const appliedFocus = useRef<number | null>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    if (!visible || activated) return;
    const frame = requestAnimationFrame(() => setActivated(true));
    return () => cancelAnimationFrame(frame);
  }, [visible, activated]);

  useEffect(() => {
    const host = canvasRef.current;
    if (!activated || !host) return;
    const cameraCache = cameras.current;
    const fittedCache = fittedKeys.current;
    let cancelled = false;
    let disposed = false;
    let adapter: MapAdapter;
    let unsubscribeAuth = () => {};
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      unsubscribeAuth();
      adapter.destroy();
    };
    const unavailable = (reason: string) => {
      latest.current.onReadyChange?.(false);
      latest.current.onUnavailable(reason);
    };
    if (import.meta.env.VITE_MAP_ADAPTER === 'fake') {
      adapter = new FakeMapAdapter();
    } else {
      const clientId = import.meta.env.VITE_NAVER_MAP_CLIENT_ID;
      if (!clientId) {
        unavailable(MAP_MISSING_CLIENT_ID_MESSAGE);
        return;
      }
      // 휴대폰에서는 SDK 막대(슬라이더)가 왼쪽 위 핀 이름표를 가리고 그 버튼은 28px로 작다. 터치 전용 기기에서는
      // SDK 막대를 빼고 아래에서 44px ＋/− 버튼(`MapZoomButtons`)을 그린다. 둘은 늘 함께 바뀐다.
      adapter = new NaverMapAdapter(clientId, { zoomControl: !touchOnly });
      unsubscribeAuth = onNaverAuthFailure(() => {
        if (cancelled) return;
        cancelled = true;
        adapterRef.current = null;
        setMountedAdapter(null);
        dispose();
        console.warn('네이버 지도 인증에 실패했어요');
        unavailable(MAP_UNAVAILABLE_MESSAGE);
      });
      if (cancelled) {
        unsubscribeAuth();
        return;
      }
    }
    adapter.onMarkerClick((id) => latest.current.onMarkerClick(id));
    adapter.onBoundsChange((b) => {
      latest.current.onBoundsChange?.(b);
      const camera = adapter.getCamera();
      if (camera) latest.current.onCenterChange?.(camera.center);
    });
    adapter.mount(host).then(
      () => {
        if (cancelled) {
          dispose();
          return;
        }
        adapterRef.current = adapter;
        setMountedAdapter(adapter);
      },
      (e: unknown) => {
        if (cancelled) return;
        cancelled = true;
        dispose();
        console.warn('지도를 불러오지 못했어요', e);
        unavailable(MAP_UNAVAILABLE_MESSAGE);
      },
    );
    return () => {
      cancelled = true;
      adapterRef.current = null;
      dispose();
      cameraCache.clear();
      fittedCache.clear();
      displayedKey.current = null;
      appliedFocus.current = null;
    };
  }, [activated, touchOnly]);

  const ready = useMapSize(frameRef, mountedAdapter, visible);
  useEffect(() => {
    latest.current.onReadyChange?.(ready);
  }, [ready]);
  const { color: clusterColor, textColor: clusterTextColor } =
    props.clusterStyle ?? DEFAULT_CLUSTER_STYLE;
  useEffect(() => {
    if (ready)
      adapterRef.current?.setClusterStyle({ color: clusterColor, textColor: clusterTextColor });
  }, [ready, clusterColor, clusterTextColor]);
  useEffect(() => {
    if (ready) adapterRef.current?.setMarkers(props.markers);
  }, [ready, props.markers]);
  useEffect(() => {
    if (ready) adapterRef.current?.setPolylines(props.polylines);
  }, [ready, props.polylines]);

  const myLocation = props.myLocation ?? null;
  const myLng = myLocation?.lng;
  const myLat = myLocation?.lat;
  const myAccuracy = myLocation?.accuracyM;
  useEffect(() => {
    if (!ready) return;
    adapterRef.current?.setMyLocation(
      myLng === undefined || myLat === undefined || myAccuracy === undefined
        ? null
        : { lng: myLng, lat: myLat, accuracyM: myAccuracy },
    );
  }, [ready, myLng, myLat, myAccuracy]);

  const key = props.fitKey ?? 'explore';
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!ready || !adapter) return;
    const fit = (points: [number, number][]) => {
      const padding = latest.current.padding;
      if (padding) adapter.fitBounds(points, padding);
      else adapter.fitBounds(points);
    };
    if (displayedKey.current !== key) {
      if (displayedKey.current !== null && fittedKeys.current.has(displayedKey.current)) {
        const old = adapter.getCamera();
        if (old) cameras.current.set(displayedKey.current, old);
      }
      const remembered = cameras.current.get(key);
      if (remembered) adapter.setCamera(remembered);
      displayedKey.current = key;
    }
    if (!fittedKeys.current.has(key)) {
      const points = fitPoints(latest.current.markers, latest.current.extraFitPoints);
      if (points.length > 0) {
        fit(points);
        fittedKeys.current.add(key);
      }
    }
    const focus = latest.current.focus;
    if (focus && focus.seq !== appliedFocus.current) {
      // fitBounds 뒤 줌을 바꾸면 지도 중심 기준으로 확대돼 padding 보정이 어긋난다. 한 번에 옮긴다.
      adapter.setCamera(focusCamera(focus.point, latest.current.padding ?? DEFAULT_PADDING));
      appliedFocus.current = focus.seq;
    }
  }, [ready, key, props.focus, props.markers, props.extraFitPoints]);

  return (
    <Box
      ref={frameRef}
      // 지도 SDK가 안쪽에 쓰는 z-index가 지도 밖(위에 덮는 오버레이 등)과 겨루지 않게 쌓임 맥락을 가둔다.
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        isolation: 'isolate',
      }}
      data-testid="map-host"
    >
      <Box ref={canvasRef} sx={{ position: 'absolute', inset: 0 }} data-testid="map-canvas" />
      {ready && mountedAdapter && (touchOnly || props.controls) && (
        <Box
          data-testid="map-controls"
          sx={{
            position: 'absolute',
            top: 8,
            right: 8 + (props.controlsRight ?? 0),
            // 지도 SDK의 레이어(`isolation`으로 가둔 쌓임 맥락) 위에 둔다.
            zIndex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          {touchOnly && <MapZoomButtons adapter={mountedAdapter} />}
          {props.controls}
        </Box>
      )}
    </Box>
  );
}
