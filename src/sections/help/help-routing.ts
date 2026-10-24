import type { HelpPageId } from './help-content';

/** 경로 경계를 지켜 비슷한 이름의 다른 화면을 잘못 안내하지 않는다. */
export function helpIdForPath(pathname: string): HelpPageId | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return 'library';
  if (path.startsWith('/place/')) return 'place';
  if (path === '/map') return 'map';
  if (path === '/labels') return 'labels';
  if (path === '/settings') return 'settings';
  if (path === '/trips' || path.startsWith('/trips/')) return 'trips';
  if (path === '/meet' || path === '/meetings' || path.startsWith('/meetings/')) return 'meetings';
  return null;
}

/** 처음 안내는 다섯 메뉴의 목록 진입에서만 띄운다. */
export function introIdForPath(
  pathname: string,
  seen: ReadonlySet<string>,
  blocked: boolean,
): HelpPageId | null {
  if (blocked) return null;
  const path = pathname.replace(/\/+$/, '') || '/';
  if (!['/', '/map', '/trips', '/meetings', '/labels'].includes(path)) return null;
  const id = helpIdForPath(path);
  return id !== null && !seen.has(id) ? id : null;
}
