import { createBrowserRouter, type RouteObject } from 'react-router';
import { ErrorScreen } from 'src/components/ErrorScreen';
import { RouteErrorScreen } from 'src/components/RouteErrorScreen';
import { paths } from 'src/routes/paths';
import { LabelsPage } from 'src/sections/labels/LabelsPage';
import { ShellRoute } from 'src/sections/shell/ShellRoute';
import { PagePlaceholder } from 'src/sections/shell/ShellSlots';
import { TripsPlaceholder } from 'src/sections/shell/TripsPlaceholder';

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
      { path: paths.settings, element: <PagePlaceholder title="설정" /> },
      { path: paths.trips, element: <TripsPlaceholder /> },
    ],
  },
  {
    path: paths.legacyTrip(':publicId'),
    // 여행 화면(지도·편집)은 별도 청크로 나눠 첫 화면을 가볍게 한다.
    lazy: async () => ({ Component: (await import('src/pages/TripPage')).TripRoute }),
    hydrateFallbackElement: <p role="status">불러오는 중…</p>,
    errorElement: <RouteErrorScreen />,
  },
  { path: '*', element: <ErrorScreen title="페이지를 찾을 수 없어요" /> },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
