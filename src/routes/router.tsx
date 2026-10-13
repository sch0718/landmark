import { Suspense, type ReactNode } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { ErrorScreen } from 'src/components/ErrorScreen';
import { LoadingNotice } from 'src/components/LoadingNotice';
import { RouteErrorScreen } from 'src/components/RouteErrorScreen';
import {
  LabelsPage,
  LegacyImportPage,
  SettingsPage,
  TripPlannerPage,
  TripsPage,
} from 'src/routes/lazy-routes';
import { paths } from 'src/routes/paths';
import { ShellRoute } from 'src/sections/shell/ShellRoute';

/**
 * 나눠 받는 화면을 감싼다. 셸은 그대로 두고 화면 자리에만 기다림 표시를 둔다.
 * 화면마다 `key`를 달리 준다: react-router는 이동을 전환으로 돌리는데, 같은 Suspense를 재사용하면 다음 화면을
 * 받는 동안 React가 기다림 표시 대신 옛 화면을 그대로 두기 때문이다.
 */
function lazyElement(page: ReactNode, key: string) {
  return (
    <Suspense key={key} fallback={<LoadingNotice />}>
      {page}
    </Suspense>
  );
}

export const routes: RouteObject[] = [
  {
    // 보관함·지도·상세는 같은 셸이 슬롯을 채운다(`AppShell`이 경로로 구분). 그 밖의 경로는 `Outlet`이 채운다.
    element: <ShellRoute />,
    errorElement: <RouteErrorScreen />,
    children: [
      { path: paths.library, element: null },
      { path: paths.map, element: null },
      { path: paths.place(':id'), element: null },
      // 진입만 하는 경로다. `useImportEntry`가 곧바로 보관함(`/`)으로 바꾸고 추가 흐름을 연다.
      { path: paths.importShare, element: null },
      { path: paths.labels, element: lazyElement(<LabelsPage />, 'labels') },
      { path: paths.settings, element: lazyElement(<SettingsPage />, 'settings') },
      {
        path: paths.legacyTrip(':publicId'),
        element: lazyElement(<LegacyImportPage />, 'legacy-trip'),
      },
      { path: paths.trips, element: lazyElement(<TripsPage />, 'trips') },
      { path: paths.trip(':id'), element: lazyElement(<TripPlannerPage />, 'trip') },
    ],
  },
  { path: '*', element: <ErrorScreen title="페이지를 찾을 수 없어요" /> },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
