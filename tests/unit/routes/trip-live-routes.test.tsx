import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router';
import { paths } from 'src/routes/paths';
import { routes } from 'src/routes/router';
import { loadTripLiveLinkPage, ROUTE_CHUNKS } from 'src/routes/lazy-routes';
describe('갱신 공유 경로', () => {
  it('관리 링크는 별도 지연 화면이고 미리 받지 않는다', () => {
    expect(paths.tripLive('abcdefghij')).toBe('/trips/live/abcdefghij');
    expect(matchRoutes(routes, '/trips/live/abcdefghij')?.at(-1)?.route.path).toBe(
      '/trips/live/:id',
    );
    expect(ROUTE_CHUNKS).not.toContain(loadTripLiveLinkPage);
  });
  it('기존 여행 경로는 계획 화면이다', () => {
    expect(matchRoutes(routes, '/trips/abcdefghij')?.at(-1)?.route.path).toBe('/trips/:id');
  });
});
