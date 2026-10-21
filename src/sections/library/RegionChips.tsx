import Box from '@mui/material/Box';
import { useState } from 'react';
import type { RegionCount } from 'src/domain/library/query';
import { ChipButton } from 'src/sections/library/ChipButton';
import { ChipScrollRow } from 'src/sections/library/ChipScrollRow';

type Props = {
  regions: ReadonlyArray<RegionCount & { children?: RegionCount[] }>;
  selected: readonly string[];
  onChange(regions: string[]): void;
  onCreateTrip?(region: string): void;
};

/** 시·도를 먼저 고르고 그 아래 시·군으로 좁힌다. 옛 선택값도 해제할 수 있게 남긴다. */
export function RegionChips({ regions, selected, onChange, onCreateTrip }: Props) {
  const [expanded, setExpanded] = useState<string | null>(
    () => selected.find((r) => r.includes('/'))?.split('/')[0] ?? null,
  );
  const shown = regions.map((r) => ({ ...r, children: [...(r.children ?? [])] }));
  for (const region of selected) {
    const [province] = region.split('/');
    if (region.includes('/')) {
      let parent = shown.find((r) => r.region === province);
      if (!parent) {
        parent = { region: province!, count: 0, children: [] };
        shown.push(parent);
      }
      if (!region.endsWith('/전체') && !parent.children.some((r) => r.region === region))
        parent.children.push({ region, count: 0 });
    } else if (!shown.some((r) => r.region === region))
      shown.push({ region, count: 0, children: [] });
  }
  if (shown.length === 0) return null;
  const toggle = (region: string) =>
    onChange(
      selected.includes(region) ? selected.filter((r) => r !== region) : [...selected, region],
    );
  const parentClick = (region: string, hasChildren: boolean) => {
    if (!hasChildren) {
      toggle(
        regions.some((r) => r.region === region) || selected.includes(`${region}/전체`)
          ? `${region}/전체`
          : region,
      );
      return;
    }
    setExpanded(region);
    const value = `${region}/전체`;
    const active = selected.includes(value);
    onChange([
      ...selected.filter((r) => r !== region && !r.startsWith(`${region}/`)),
      ...(active ? [] : [value]),
    ]);
  };
  const childClick = (region: string) => {
    const parent = region.split('/')[0]!;
    onChange(
      selected.includes(region)
        ? selected.filter((r) => r !== region)
        : [...selected.filter((r) => r !== `${parent}/전체`), region],
    );
  };
  const current = shown.find((r) => r.region === expanded);
  const chip = (region: string, count: number, child = false) => (
    <ChipButton
      key={region}
      selected={
        ((child || !regions.some((r) => r.region === region)) && selected.includes(region)) ||
        (!child && selected.some((r) => r.startsWith(`${region}/`)))
      }
      onClick={() =>
        child
          ? childClick(region)
          : parentClick(region, (shown.find((r) => r.region === region)?.children.length ?? 0) > 0)
      }
    >
      {child ? region.split('/')[1] : region}{' '}
      <Box component="span" sx={{ fontWeight: 500 }}>
        {count}
      </Box>
    </ChipButton>
  );
  return (
    <Box role="group" aria-label="지역">
      <ChipScrollRow label="시·도">
        {shown.map(({ region, count }) => chip(region, count))}
        {selected
          .filter((r) => !r.includes('/') && regions.some((p) => p.region === r))
          .map((r) => (
            <ChipButton key={`old:${r}`} selected onClick={() => toggle(r)}>
              {r} (이전 선택)
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
      </ChipScrollRow>
      {current && current.children.length > 0 && (
        <ChipScrollRow label={`${current.region} 시·군`}>
          <ChipButton
            selected={selected.includes(`${current.region}/전체`)}
            onClick={() => parentClick(current.region, true)}
          >
            {current.region} 전체 {current.count}
          </ChipButton>
          {current.children.map(({ region, count }) => chip(region, count, true))}
        </ChipScrollRow>
      )}
    </Box>
  );
}
