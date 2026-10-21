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
export const loadTripTodayPage = lazyChunk(() => import('src/sections/trips/today/TripTodayPage'));
export const loadSettingsPage = lazyChunk(() => import('src/sections/settings/SettingsPage'));
export const loadLabelsPage = lazyChunk(() => import('src/sections/labels/LabelsPage'));
export const loadLegacyImportPage = lazyChunk(
  () => import('src/sections/settings/LegacyImportPage'),
);

export const TripsPage = lazy(() => loadTripsPage().then((m) => ({ default: m.TripsPage })));
export const TripPlannerPage = lazy(() =>
  loadTripPlannerPage().then((m) => ({ default: m.TripPlannerPage })),
);
export const TripTodayPage = lazy(() =>
  loadTripTodayPage().then((m) => ({ default: m.TripTodayPage })),
);
export const SettingsPage = lazy(() =>
  loadSettingsPage().then((m) => ({ default: m.SettingsPage })),
);
export const LabelsPage = lazy(() => loadLabelsPage().then((m) => ({ default: m.LabelsPage })));
export const LegacyImportPage = lazy(() =>
  loadLegacyImportPage().then((m) => ({ default: m.LegacyImportPage })),
);

/**
 * 추가 칸의 단계 화면과 공유 내보내기·일정 공유·백업 되살리기·라벨 고르기 대화상자도 열 때 받는다. 핀 찍기 덮개(`PinModeOverlay`)는 지도 위에 바로
 * 떠야 해서 나누지 않는다. 받기가 실패하면 쓰는 쪽(`AddPlaceHost`·`ExportHtmlDialogHost`)의 `ChunkErrorBoundary`가
 * 그 칸·대화상자 안에 새 버전 안내를 보인다. 되살리기·일정 공유 대화상자(`RestoreDialogHost`·`TripShareDialogHost`)도 같다.
 */
export const loadLinkInputPanel = lazyChunk(() => import('src/sections/add-place/LinkInputPanel'));
export const loadCandidateCard = lazyChunk(() => import('src/sections/add-place/CandidateCard'));
export const loadFolderPreview = lazyChunk(() => import('src/sections/add-place/FolderPreview'));
export const loadPinCard = lazyChunk(() => import('src/sections/add-place/PinCard'));
export const loadSharePickPanel = lazyChunk(
  () => import('src/sections/share-import/SharePickPanel'),
);
export const loadSharePreview = lazyChunk(() => import('src/sections/share-import/SharePreview'));
export const loadExportHtmlDialog = lazyChunk(
  () => import('src/sections/share-export/ExportHtmlDialog'),
);
export const loadRestoreDialog = lazyChunk(() => import('src/sections/backup/RestoreDialog'));
export const loadTripShareDialog = lazyChunk(
  () => import('src/sections/share-export/TripShareDialog'),
);
export const loadLabelFilterDialog = lazyChunk(
  () => import('src/sections/library/LabelFilterDialog'),
);
export const loadLabelPickerDialog = lazyChunk(
  () => import('src/sections/place/LabelPickerDialog'),
);

export const LinkInputPanel = lazy(() =>
  loadLinkInputPanel().then((m) => ({ default: m.LinkInputPanel })),
);
export const CandidateCard = lazy(() =>
  loadCandidateCard().then((m) => ({ default: m.CandidateCard })),
);
export const FolderPreview = lazy(() =>
  loadFolderPreview().then((m) => ({ default: m.FolderPreview })),
);
export const PinCard = lazy(() => loadPinCard().then((m) => ({ default: m.PinCard })));
export const SharePickPanel = lazy(() =>
  loadSharePickPanel().then((m) => ({ default: m.SharePickPanel })),
);
export const SharePreview = lazy(() =>
  loadSharePreview().then((m) => ({ default: m.SharePreview })),
);
export const ExportHtmlDialog = lazy(() =>
  loadExportHtmlDialog().then((m) => ({ default: m.ExportHtmlDialog })),
);
export const RestoreDialog = lazy(() =>
  loadRestoreDialog().then((m) => ({ default: m.RestoreDialog })),
);
export const TripShareDialog = lazy(() =>
  loadTripShareDialog().then((m) => ({ default: m.TripShareDialog })),
);
export const LabelPickerDialog = lazy(() =>
  loadLabelPickerDialog().then((m) => ({ default: m.LabelPickerDialog })),
);

/** 첫 화면을 그린 뒤 한가할 때 미리 받는 화면 단위들. */
export const ROUTE_CHUNKS: readonly (() => Promise<unknown>)[] = [
  loadTripsPage,
  loadTripPlannerPage,
  loadTripTodayPage,
  loadSettingsPage,
  loadLabelsPage,
  loadLegacyImportPage,
];

/** 같은 때 미리 받는 추가 칸 단계와 내보내기·되살리기·일정 공유·라벨 고르기 대화상자 단위들. */
export const PANEL_CHUNKS: readonly (() => Promise<unknown>)[] = [
  loadLinkInputPanel,
  loadCandidateCard,
  loadFolderPreview,
  loadPinCard,
  loadSharePickPanel,
  loadSharePreview,
  loadExportHtmlDialog,
  loadRestoreDialog,
  loadTripShareDialog,
  loadLabelPickerDialog,
];

export const LabelFilterDialog = lazy(() =>
  loadLabelFilterDialog().then((m) => ({ default: m.LabelFilterDialog })),
);
