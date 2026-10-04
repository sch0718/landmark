import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useAtom, useAtomValue } from 'jotai';
import { allTags, categoryCounts, type ExploreFilter } from 'src/sections/explore/store/filters';
import { exploreFilterAtom } from 'src/sections/explore/store/explore-state';
import { useTripStore } from 'src/stores/trip-store';

const toggle = (list: string[], value: string): string[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

function ToggleChip(props: { label: string; on: boolean; onClick(): void }) {
  return (
    <Chip
      size="small"
      label={props.label}
      color={props.on ? 'primary' : 'default'}
      variant={props.on ? 'filled' : 'outlined'}
      aria-pressed={props.on}
      onClick={props.onClick}
    />
  );
}

export function ExploreFilters() {
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const edit = useAtomValue(ts.editLayerAtom);
  const [filter, setFilter] = useAtom(exploreFilterAtom);
  if (!trip) return null;
  const patch = (p: Partial<ExploreFilter>) => setFilter({ ...filter, ...p });
  // 선택된 태그의 마지막 사용이 지워져도 칩이 남아 있어야 해제할 수 있다.
  const tags = [...new Set([...allTags(edit), ...filter.tags])].sort((a, b) =>
    a.localeCompare(b, 'ko'),
  );

  return (
    <Stack spacing={1} sx={{ p: 1.5 }} role="group" aria-label="필터">
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {trip.folders.map((f) => (
          <ToggleChip
            key={f.id}
            label={`${f.name} ${f.count}`}
            on={filter.folderIds.includes(f.id)}
            onClick={() => patch({ folderIds: toggle(filter.folderIds, f.id) })}
          />
        ))}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {categoryCounts(trip).map((c) => (
          <ToggleChip
            key={c.category}
            label={`${c.category} ${c.count}`}
            on={filter.categories.includes(c.category)}
            onClick={() => patch({ categories: toggle(filter.categories, c.category) })}
          />
        ))}
      </Box>
      {tags.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {tags.map((t) => (
            <ToggleChip
              key={t}
              label={`#${t}`}
              on={filter.tags.includes(t)}
              onClick={() => patch({ tags: toggle(filter.tags, t) })}
            />
          ))}
        </Box>
      )}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1 }}>
        <TextField
          select
          size="small"
          label="일정 상태"
          value={filter.inItinerary}
          onChange={(e) => patch({ inItinerary: e.target.value as ExploreFilter['inItinerary'] })}
          sx={{ minWidth: 120 }}
        >
          <MenuItem value="any">전체</MenuItem>
          <MenuItem value="in">일정에 있음</MenuItem>
          <MenuItem value="out">일정에 없음</MenuItem>
        </TextField>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={filter.hasMemo}
              onChange={(e) => patch({ hasMemo: e.target.checked })}
            />
          }
          label="메모 있음"
        />
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={filter.showHidden}
              onChange={(e) => patch({ showHidden: e.target.checked })}
            />
          }
          label="숨김 포함"
        />
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={filter.inViewOnly}
              onChange={(e) => patch({ inViewOnly: e.target.checked })}
            />
          }
          label="지도 영역 안만 보기"
        />
      </Box>
    </Stack>
  );
}
