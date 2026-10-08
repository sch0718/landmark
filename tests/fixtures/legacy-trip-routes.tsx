import type { RouteObject } from 'react-router';
import { ErrorScreen } from 'src/components/ErrorScreen';
import { RouteErrorScreen } from 'src/components/RouteErrorScreen';
import { paths } from 'src/routes/paths';

/**
 * 옛 여행 화면(`TripPage`)만 라우트로 건 표. `/t/:publicId`는 이제 가져오기 화면이지만, 옛 화면 테스트는
 * 화면이 지워질 때(Task 17)까지 이 표로 그대로 그린다.
 */
export const legacyTripRoutes: RouteObject[] = [
  {
    path: paths.legacyTrip(':publicId'),
    lazy: async () => ({ Component: (await import('src/pages/TripPage')).TripRoute }),
    hydrateFallbackElement: <p role="status">불러오는 중…</p>,
    errorElement: <RouteErrorScreen />,
  },
  { path: '*', element: <ErrorScreen title="페이지를 찾을 수 없어요" /> },
];
