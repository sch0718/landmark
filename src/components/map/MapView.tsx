import Box from '@mui/material/Box';
import { useEffect, useRef, useState } from 'react';
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
} from './MapAdapter';
import { onNaverAuthFailure } from './load-naver-sdk';
import { NaverMapAdapter } from './NaverMapAdapter';
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
  /** 값이 바뀔 때마다 그 지점 근처(약 200m 상자, 줌 15~17)로 지도를 옮긴다. */
  focus?: { point: [number, number]; seq: number } | null;
  onUnavailable(reason: string): void;
  /**
   * 값이 바뀌면(모드 전환·Day 탭 변경 등 마커 집합이 바뀌는 순간) 그때의 마커 전체가 보이게 지도를 맞춘다.
   * 마운트 직후에도 한 번 맞춘다. 같은 값에서 마커만 바뀌는 경우(편집·선택)에는 맞추지 않는다.
   */
  fitKey?: string;
};

const FOCUS_PAD = 0.005;
/** 장소로 이동(focus)할 때 맞추는 상자의 반변(약 200m). 지도 폭이 달라도 이웃에 묶이지 않을 만큼 가깝게 당긴다. */
const FOCUS_BOX = 0.002;
/** focus 뒤 줌 범위. 15부터는 클러스터 없이 모든 장소가 개별로 보인다. */
const FOCUS_MIN_ZOOM = 15;
const FOCUS_MAX_ZOOM = 17;

/** 흐린(후보) 마커를 뺀 마커 좌표. 모두 흐리면 전부. 점이 하나뿐이면 그 근처(약 1km)로 넓힌다. */
export function fitPoints(markers: MapMarker[]): [number, number][] {
  const strong = markers.filter((m) => !m.dimmed);
  const pts = (strong.length > 0 ? strong : markers).map((m): [number, number] => [m.lng, m.lat]);
  const unique = new Set(pts.map(([lng, lat]) => `${lng},${lat}`));
  if (unique.size !== 1) return pts;
  const [lng, lat] = pts[0]!;
  return [
    [lng - FOCUS_PAD, lat - FOCUS_PAD],
    [lng + FOCUS_PAD, lat + FOCUS_PAD],
  ];
}

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
      adapter = new NaverMapAdapter(clientId);
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
    adapter.onBoundsChange((b) => latest.current.onBoundsChange?.(b));
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
  }, [activated]);

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
      const points = fitPoints(latest.current.markers);
      if (points.length > 0) {
        fit(points);
        fittedKeys.current.add(key);
      }
    }
    const focus = latest.current.focus;
    if (focus && focus.seq !== appliedFocus.current) {
      const [lng, lat] = focus.point;
      fit([
        [lng - FOCUS_BOX, lat - FOCUS_BOX],
        [lng + FOCUS_BOX, lat + FOCUS_BOX],
      ]);
      const camera = adapter.getCamera();
      if (camera) {
        const zoom = Math.min(FOCUS_MAX_ZOOM, Math.max(FOCUS_MIN_ZOOM, camera.zoom));
        if (zoom !== camera.zoom) adapter.setCamera({ ...camera, zoom });
      }
      appliedFocus.current = focus.seq;
    }
  }, [ready, key, props.focus, props.markers]);

  return (
    <Box
      ref={frameRef}
      sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
      data-testid="map-host"
    >
      <Box ref={canvasRef} sx={{ position: 'absolute', inset: 0 }} data-testid="map-canvas" />
    </Box>
  );
}
