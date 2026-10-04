import { createBrowserRouter, type RouteObject } from 'react-router';
import { ErrorScreen } from 'src/components/ErrorScreen';
import { RouteErrorScreen } from 'src/components/RouteErrorScreen';
import { HomePage } from 'src/pages/HomePage';
import { paths } from 'src/routes/paths';

export const routes: RouteObject[] = [
  { path: paths.home, element: <HomePage />, errorElement: <RouteErrorScreen /> },
  {
    path: paths.trip(':publicId'),
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
