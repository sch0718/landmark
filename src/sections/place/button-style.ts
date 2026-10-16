/** 장소 상세의 테두리 버튼(44px). `PlaceDetail`과 `VisitEditor`가 같이 쓴다. */
export const BUTTON_SX = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.75,
  minHeight: 44,
  px: 1.5,
  border: '1px solid var(--tm-border)',
  borderRadius: 'var(--tm-radius-md)',
  background: 'transparent',
  color: 'var(--tm-text-primary)',
  font: 'inherit',
  fontSize: 14,
  fontWeight: 700,
  textDecoration: 'none',
  cursor: 'pointer',
  '& svg': { width: 16, height: 16 },
} as const;
