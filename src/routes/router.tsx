import { createBrowserRouter, type RouteObject } from 'react-router';
import { ErrorScreen } from 'src/components/ErrorScreen';
import { RouteErrorScreen } from 'src/components/RouteErrorScreen';
import { paths } from 'src/routes/paths';
import { LabelsPage } from 'src/sections/labels/LabelsPage';
import { LegacyImportPage } from 'src/sections/settings/LegacyImportPage';
import { SettingsPage } from 'src/sections/settings/SettingsPage';
import { ShellRoute } from 'src/sections/shell/ShellRoute';
import { TripsPage } from 'src/sections/trips/TripsPage';

export const routes: RouteObject[] = [
  {
    // 보관함·지도·상세는 같은 셸이 슬롯을 채운다(`AppShell`이 경로로 구분). 그 밖의 경로는 `Outlet`이 채운다.
    element: <ShellRoute />,
    errorElement: <RouteErrorScreen />,
    children: [
      { path: paths.library, element: null },
      { path: paths.map, element: null },
      { path: paths.place(':id'), element: null },
      { path: paths.labels, element: <LabelsPage /> },
      { path: paths.settings, element: <SettingsPage /> },
      { path: paths.legacyTrip(':publicId'), element: <LegacyImportPage /> },
      { path: paths.trips, element: <TripsPage /> },
    ],
  },
  { path: '*', element: <ErrorScreen title="페이지를 찾을 수 없어요" /> },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
