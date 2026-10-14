import { useState, type ReactNode } from 'react';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
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
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
