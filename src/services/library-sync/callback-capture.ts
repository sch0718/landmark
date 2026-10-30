export const AUTH_CALLBACK_PATH = '/auth/callback';
let captured: string | null = null;
export function captureAuthCallback(
  loc: Location = window.location,
  history: History = window.history,
): void {
  const query = new URLSearchParams(loc.search);
  if (loc.pathname === AUTH_CALLBACK_PATH && (query.has('code') || query.has('error'))) {
    captured = loc.href;
    history.replaceState(history.state, '', AUTH_CALLBACK_PATH);
  }
}
export function takeCapturedCallback(): string | null {
  const href = captured;
  captured = null;
  return href;
}
