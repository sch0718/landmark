import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from 'src/app';
import { captureAuthCallback } from 'src/services/library-sync/callback-capture';

captureAuthCallback();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
