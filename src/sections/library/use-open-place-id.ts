import { matchPath, useLocation } from 'react-router';
import { paths } from 'src/routes/paths';

/** 경로 `/place/:id`로 열려 있는 장소의 id. 열린 장소가 없으면 `null`. */
export function useOpenPlaceId(): string | null {
  const { pathname } = useLocation();
  return matchPath(paths.place(':id'), pathname)?.params.id ?? null;
}
