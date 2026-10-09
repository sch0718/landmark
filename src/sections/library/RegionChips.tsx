import Box from '@mui/material/Box';
import { ChipButton } from 'src/sections/library/ChipButton';

type Props = {
  /** `regionCounts` 순서(개수 내림차순, `기타`는 마지막). */
  regions: ReadonlyArray<{ region: string; count: number }>;
  selected: readonly string[];
  /** 선택한 지역을 눌러 바꾼다. 여러 개를 고르면 하나라도 맞는 장소(OR). */
  onChange(regions: string[]): void;
};

/** 지역 칩 줄. 다른 필터로 개수가 0이 된 선택 지역도 남겨서 풀 수 있게 한다. */
export function RegionChips({ regions, selected, onChange }: Props) {
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
          <Box component="span" sx={{ fontWeight: 500, opacity: 0.8 }}>
            {count}
          </Box>
        </ChipButton>
      ))}
    </Box>
  );
}
