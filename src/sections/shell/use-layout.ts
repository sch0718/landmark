import useMediaQuery from '@mui/material/useMediaQuery';

export type Layout = 'wide' | 'medium' | 'compact';

/**
 * 반응형 경계(스펙 §4.1): ≥1280 3단, 768–1279 2단 + 상세 오버레이, <768 하단 탭.
 * `noSsr`: 첫 렌더부터 실제 화면 크기로 판정한다(기본값은 좁은 화면으로 시작했다가 바뀐다).
 */
export function useLayout(): Layout {
  const wide = useMediaQuery('(min-width:1280px)', { noSsr: true });
  const medium = useMediaQuery('(min-width:768px)', { noSsr: true });
  return wide ? 'wide' : medium ? 'medium' : 'compact';
}
