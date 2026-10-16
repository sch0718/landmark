import Box from '@mui/material/Box';
import type { VisitFilter } from 'src/domain/library/query';
import { ChipButton } from 'src/sections/library/ChipButton';

type Props = {
  value: VisitFilter;
  /** `visitCounts` 결과. */
  counts: { visited: number; unvisited: number };
  onChange(value: VisitFilter): void;
};

const CHIPS: ReadonlyArray<{ value: 'unvisited' | 'visited'; label: string }> = [
  { value: 'unvisited', label: '안 가 본 곳' },
  { value: 'visited', label: '가 본 곳' },
];

/** `방문` 필터 칩 둘. 켜진 칩을 다시 누르면 `all`로 돌아간다. */
export function VisitChips({ value, counts, onChange }: Props) {
  return (
    <Box role="group" aria-label="방문" sx={{ display: 'flex', gap: 0.5, flex: 'none' }}>
      {CHIPS.map((chip) => (
        <ChipButton
          key={chip.value}
          selected={value === chip.value}
          onClick={() => onChange(value === chip.value ? 'all' : chip.value)}
        >
          {chip.label}{' '}
          <Box component="span" sx={{ fontWeight: 500 }}>
            {counts[chip.value]}
          </Box>
        </ChipButton>
      ))}
    </Box>
  );
}
