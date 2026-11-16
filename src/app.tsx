import { useEffect, useState, type ReactNode } from 'react';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { paths } from 'src/routes/paths';
import { createAppRouter } from 'src/routes/router';
import { ThemeRoot } from 'src/theme/ThemeRoot';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeRoot>
      {children}
      <Toaster position="top-center" customAriaLabel="알림" />
    </ThemeRoot>
  );
}

export function App() {
  const [router] = useState(createAppRouter);
  // 새 버전 안내·「바뀐 점」은 첫 화면 예산 밖에서 받는다. 개발 서버·시험에서는 켜지 않는다.
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    import('src/services/app-update/app-update').then(
      (m) => {
        if (cancelled) return;
        stop = m.startAppUpdate(import.meta.env.APP_VERSION, () => {
          void router.navigate(`${paths.help}#release-notes`);
        });
      },
      () => {
        // 새 배포로 옛 파일이 없으면 받지 못한다. 그때는 화면 이동 때 나눠 받기 실패 안내가 대신한다.
      },
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [router]);
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
