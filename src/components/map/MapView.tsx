import Box from '@mui/material/Box';
import { useEffect, useRef } from 'react';
import { FakeMapAdapter } from './FakeMapAdapter';
import type { Bounds, MapAdapter, MapMarker, MapPolyline } from './MapAdapter';
import { onNaverAuthFailure } from './load-naver-sdk';
import { NaverMapAdapter } from './NaverMapAdapter';

export const MAP_UNAVAILABLE_MESSAGE = '지도를 불러오지 못했어요. 도메인 등록을 확인하세요';
export const MAP_MISSING_CLIENT_ID_MESSAGE =
  '지도 키가 설정되지 않았어요. 환경변수 VITE_NAVER_MAP_CLIENT_ID를 확인하세요';

type Props = {
  markers: MapMarker[];
  polylines: MapPolyline[];
  onMarkerClick(id: string): void;
  onBoundsChange?(b: Bounds): void;
  /** 값이 바뀔 때마다 그 지점 근처(약 1km)로 지도를 옮긴다. */
  focus?: { point: [number, number]; seq: number } | null;
  onUnavailable(reason: string): void;
  /**
   * 값이 바뀌면(모드 전환·Day 탭 변경 등 마커 집합이 바뀌는 순간) 그때의 마커 전체가 보이게 지도를 맞춘다.
   * 마운트 직후에도 한 번 맞춘다. 같은 값에서 마커만 바뀌는 경우(편집·선택)에는 맞추지 않는다.
   */
  fitKey?: string;
};

const FOCUS_PAD = 0.005;

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
  const hostRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<MapAdapter | null>(null);
  /** 마지막으로 fitBounds를 한 fitKey(아직 안 했으면 undefined). */
  const fittedKey = useRef<string | undefined>(undefined);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let adapter: MapAdapter;
    let unsubscribeAuth = () => {};
    if (import.meta.env.VITE_MAP_ADAPTER === 'fake') {
      adapter = new FakeMapAdapter();
    } else {
      const clientId = import.meta.env.VITE_NAVER_MAP_CLIENT_ID;
      if (!clientId) {
        latest.current.onUnavailable(MAP_MISSING_CLIENT_ID_MESSAGE);
        return;
      }
      adapter = new NaverMapAdapter(clientId);
      // 미등록 도메인: SDK가 로드 뒤 navermap_authFailure를 부른다(로드 중이면 mount가 reject된다).
      unsubscribeAuth = onNaverAuthFailure(() => {
        if (cancelled) return;
        cancelled = true;
        console.warn('네이버 지도 인증에 실패했어요');
        latest.current.onUnavailable(MAP_UNAVAILABLE_MESSAGE);
      });
    }
    adapter.onMarkerClick((id) => latest.current.onMarkerClick(id));
    adapter.onBoundsChange((b) => latest.current.onBoundsChange?.(b));
    adapter.mount(host).then(
      () => {
        if (cancelled) {
          adapter.destroy();
          return;
        }
        adapterRef.current = adapter;
        adapter.setMarkers(latest.current.markers);
        adapter.setPolylines(latest.current.polylines);
        fittedKey.current = latest.current.fitKey;
        const pts = fitPoints(latest.current.markers);
        if (pts.length > 0) adapter.fitBounds(pts);
      },
      (e: unknown) => {
        console.warn('지도를 불러오지 못했어요', e);
        if (!cancelled) latest.current.onUnavailable(MAP_UNAVAILABLE_MESSAGE);
      },
    );
    return () => {
      cancelled = true;
      unsubscribeAuth();
      adapterRef.current = null;
      adapter.destroy();
    };
  }, []);

  useEffect(() => {
    adapterRef.current?.setMarkers(props.markers);
  }, [props.markers]);
  useEffect(() => {
    adapterRef.current?.setPolylines(props.polylines);
  }, [props.polylines]);

  const { fitKey, markers } = props;
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || fittedKey.current === fitKey) return;
    fittedKey.current = fitKey;
    const pts = fitPoints(markers);
    if (pts.length > 0) adapter.fitBounds(pts);
    // markers는 fitKey가 바뀐 그 렌더의 값만 쓴다. 마커만 바뀌면(편집·선택) 다시 맞추지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  const focus = props.focus;
  useEffect(() => {
    if (!focus) return;
    const [lng, lat] = focus.point;
    adapterRef.current?.fitBounds([
      [lng - FOCUS_PAD, lat - FOCUS_PAD],
      [lng + FOCUS_PAD, lat + FOCUS_PAD],
    ]);
  }, [focus]);

  return <Box ref={hostRef} sx={{ width: '100%', height: '100%' }} data-testid="map-host" />;
}
