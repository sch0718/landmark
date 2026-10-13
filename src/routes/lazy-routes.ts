import { lazy } from 'react';
import { lazyChunk } from 'src/lib/lazy-chunk';

/**
 * 첫 화면(보관함·지도·장소 상세)이 아닌 화면은 들어갈 때 받는다. 받기가 실패하면(새 배포 뒤 옛 파일 없음 등)
 * `ChunkLoadError`가 렌더 중 던져져 셸 라우트의 `errorElement`가 새 버전 안내를 보인다.
 * react-router의 라우트 `lazy`는 쓰지 않는다: 직접 진입하면 셸까지 늦게 그려져 빈 화면이 된다.
 */
export const loadTripsPage = lazyChunk(() => import('src/sections/trips/TripsPage'));
export const loadTripPlannerPage = lazyChunk(
  () => import('src/sections/trips/planner/TripPlannerPage'),
);
export const loadSettingsPage = lazyChunk(() => import('src/sections/settings/SettingsPage'));
export const loadLabelsPage = lazyChunk(() => import('src/sections/labels/LabelsPage'));
export const loadLegacyImportPage = lazyChunk(
  () => import('src/sections/settings/LegacyImportPage'),
);

export const TripsPage = lazy(() => loadTripsPage().then((m) => ({ default: m.TripsPage })));
export const TripPlannerPage = lazy(() =>
  loadTripPlannerPage().then((m) => ({ default: m.TripPlannerPage })),
);
export const SettingsPage = lazy(() =>
  loadSettingsPage().then((m) => ({ default: m.SettingsPage })),
);
export const LabelsPage = lazy(() => loadLabelsPage().then((m) => ({ default: m.LabelsPage })));
export const LegacyImportPage = lazy(() =>
  loadLegacyImportPage().then((m) => ({ default: m.LegacyImportPage })),
);

/** 첫 화면을 그린 뒤 한가할 때 미리 받는 단위들. 추가 칸 단계·대화상자 목록은 여기에 더한다. */
export const ROUTE_CHUNKS: readonly (() => Promise<unknown>)[] = [
  loadTripsPage,
  loadTripPlannerPage,
  loadSettingsPage,
  loadLabelsPage,
  loadLegacyImportPage,
];
