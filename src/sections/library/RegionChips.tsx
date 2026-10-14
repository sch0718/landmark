import Box from '@mui/material/Box';
import { ChipButton } from 'src/sections/library/ChipButton';

type Props = {
  /** `regionCounts` 순서(개수 내림차순, `기타`는 마지막). */
  regions: ReadonlyArray<{ region: string; count: number }>;
  selected: readonly string[];
  /** 선택한 지역을 눌러 바꾼다. 여러 개를 고르면 하나라도 맞는 장소(OR). */
  onChange(regions: string[]): void;
  /** 주어지면 지역을 하나만 골랐을 때 칩 줄 끝에 `이 지역으로 여행 만들기`를 둔다. */
  onCreateTrip?(region: string): void;
};

/** 지역 칩 줄. 다른 필터로 개수가 0이 된 선택 지역도 남겨서 풀 수 있게 한다. */
export function RegionChips({ regions, selected, onChange, onCreateTrip }: Props) {
  const shown = [...regions];
  for (const region of selected) {
    if (!shown.some((r) => r.region === region)) shown.push({ region, count: 0 });
  }
  if (shown.length === 0) return null;
  const toggle = (region: string) =>
    onChange(
      selected.includes(region) ? selected.filter((r) => r !== region) : [...selected, region],
    );
  return (
    <Box
      role="group"
      aria-label="지역"
      sx={{ display: 'flex', gap: 0.5, overflowX: 'auto', px: 2, scrollbarWidth: 'none' }}
    >
      {shown.map(({ region, count }) => (
        <ChipButton
          key={region}
          selected={selected.includes(region)}
          onClick={() => toggle(region)}
        >
          {region}{' '}
          <Box component="span" sx={{ fontWeight: 500 }}>
            {count}
          </Box>
        </ChipButton>
      ))}
      {onCreateTrip !== undefined && selected.length === 1 && (
        <Box
          component="button"
          type="button"
          onClick={() => onCreateTrip(selected[0]!)}
          sx={{
            flex: 'none',
            minHeight: 44,
            px: 1.5,
            border: 0,
            background: 'transparent',
            font: 'inherit',
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--tm-accent-text)',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            '&:focus-visible': { outlineOffset: -2 },
          }}
        >
          이 지역으로 여행 만들기
        </Box>
      )}
    </Box>
  );
}
