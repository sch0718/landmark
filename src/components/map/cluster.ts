import Supercluster from 'supercluster';
import type { Bounds, MapMarker } from './MapAdapter';

export type ClusterFeature =
  | { kind: 'cluster'; id: number; lng: number; lat: number; count: number }
  | { kind: 'point'; markerId: string; lng: number; lat: number };

export type ClusterIndex = {
  index: Supercluster<{ markerId: string }>;
  /** 클러스터링하지 않는 마커(항상 개별 표시). */
  fixed: MapMarker[];
  expansionZoom(clusterId: number): number;
};

/** 줌 15부터는 장소를 묶지 않고 모두 개별로 보인다(`maxZoom` 14 → 15에서 해제). */
export function buildClusterIndex(markers: MapMarker[]): ClusterIndex {
  const index = new Supercluster<{ markerId: string }>({ radius: 60, maxZoom: 14 });
  index.load(
    markers
      .filter((m) => m.clusterable)
      .map((m) => ({
        type: 'Feature' as const,
        properties: { markerId: m.id },
        geometry: { type: 'Point' as const, coordinates: [m.lng, m.lat] },
      })),
  );
  return {
    index,
    fixed: markers.filter((m) => !m.clusterable),
    expansionZoom: (id) => index.getClusterExpansionZoom(id),
  };
}

/** bbox·줌에서 보이는 클러스터/개별 점. 줌은 정수로 내림해 계산한다. */
export function clusterFeatures(ci: ClusterIndex, bounds: Bounds, zoom: number): ClusterFeature[] {
  const z = Math.max(0, Math.floor(zoom));
  const box: [number, number, number, number] = [
    bounds.west,
    bounds.south,
    bounds.east,
    bounds.north,
  ];
  return ci.index.getClusters(box, z).map((f): ClusterFeature => {
    const [lng, lat] = f.geometry.coordinates as [number, number];
    const p = f.properties;
    if ('cluster' in p && p.cluster) {
      return { kind: 'cluster', id: p.cluster_id, lng, lat, count: p.point_count };
    }
    return { kind: 'point', markerId: (p as { markerId: string }).markerId, lng, lat };
  });
}
