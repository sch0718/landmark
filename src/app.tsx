import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { useState, type ReactNode } from 'react';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { createAppRouter } from 'src/routes/router';
import { theme } from 'src/theme/theme';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
      <Toaster position="top-center" />
    </ThemeProvider>
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
