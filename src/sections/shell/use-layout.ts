import useMediaQuery from '@mui/material/useMediaQuery';

export type Layout = 'wide' | 'medium' | 'compact';

/**
 * 반응형 경계(스펙 §4.1): ≥1280 3단, 768–1279 2단 + 상세 오버레이, <768 하단 탭.
 * `noSsr`는 첫 렌더 보호용이다(클라이언트 첫 렌더는 이미 맞고, 서버 스냅숏 경로만 달랐다).
 */
export function useLayout(): Layout {
  const wide = useMediaQuery('(min-width:1280px)', { noSsr: true });
  const medium = useMediaQuery('(min-width:768px)', { noSsr: true });
  return wide ? 'wide' : medium ? 'medium' : 'compact';
}
