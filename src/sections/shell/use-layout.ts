import useMediaQuery from '@mui/material/useMediaQuery';

export type Layout = 'wide' | 'medium' | 'compact';

/** 반응형 경계(스펙 §4.1): ≥1280 3단, 768–1279 2단 + 상세 오버레이, <768 하단 탭. */
export function useLayout(): Layout {
  const wide = useMediaQuery('(min-width:1280px)');
  const medium = useMediaQuery('(min-width:768px)');
  return wide ? 'wide' : medium ? 'medium' : 'compact';
}
