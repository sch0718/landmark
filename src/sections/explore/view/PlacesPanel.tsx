import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { useCallback } from 'react';
import {
  detailAtom,
  placeDisplayAtom,
  searchFocusRequestedAtom,
} from 'src/sections/views/store/view-session';
import { useTripStore } from 'src/stores/trip-store';
import { selectedPlaceAtom, searchQueryAtom } from 'src/stores/ui-store';
import { exploreFilterAtom, useExploreKeys } from '../store/explore-state';
import { summarizePlace } from '../store/place-summary';
import { FilterBar } from './FilterBar';
import { PlaceList } from './PlaceList';
import { PlaceTile } from './PlaceTile';
import { VirtualPlaceRows } from './VirtualPlaceRows';

export function PlacesPanel() {
  const ts = useTripStore();
  const store = useStore();
  const searchInputRef = useCallback(
    (input: HTMLInputElement | null) => {
      if (!input || !store.get(searchFocusRequestedAtom)) return;
      input.focus();
      if (document.activeElement === input) store.set(searchFocusRequestedAtom, false);
    },
    [store],
  );
  const trip = useAtomValue(ts.tripAtom);
  const edit = useAtomValue(ts.editLayerAtom);
  const effective = useAtomValue(ts.effectiveTripAtom);
  const keys = useExploreKeys();
  const [display, setDisplay] = useAtom(placeDisplayAtom);
  const [query, setQuery] = useAtom(searchQueryAtom);
  const [filter, setFilter] = useAtom(exploreFilterAtom);
  const setSelectedPlace = useSetAtom(selectedPlaceAtom);
  const setDetail = useSetAtom(detailAtom);
  if (!trip || !effective)
    return (
      <VirtualPlaceRows
        keys={[]}
        variant="grid"
        content={ts}
        ready={false}
        renderPlace={() => null}
      />
    );
  const open = (key: string) => {
    setSelectedPlace(key);
    setDetail({ kind: 'place', placeKey: key });
  };
  return (
    <Box data-testid="places-panel">
      <TextField
        inputRef={searchInputRef}
        fullWidth
        placeholder="장소·메모·태그 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        slotProps={{ htmlInput: { 'aria-label': '검색', 'data-trip-search': true } }}
      />
      <Box sx={{ display: 'flex', gap: 0.75, p: 1, overflowX: 'auto' }}>
        {trip.folders.map((folder) => (
          <Chip
            key={folder.id}
            label={folder.name}
            aria-pressed={filter.folderIds.includes(folder.id)}
            color={filter.folderIds.includes(folder.id) ? 'primary' : 'default'}
            onClick={() =>
              setFilter((f) => ({
                ...f,
                folderIds: f.folderIds.includes(folder.id)
                  ? f.folderIds.filter((id) => id !== folder.id)
                  : [...f.folderIds, folder.id],
              }))
            }
          />
        ))}
      </Box>
      <FilterBar />
      <ToggleButtonGroup
        exclusive
        value={display}
        aria-label="장소 표시 방식"
        onChange={(_e, next: 'grid' | 'list' | null) => {
          if (next) setDisplay(next);
        }}
      >
        <ToggleButton value="grid">카드</ToggleButton>
        <ToggleButton value="list">목록</ToggleButton>
      </ToggleButtonGroup>
      {display === 'list' ? (
        <PlaceList keys={keys} />
      ) : (
        <VirtualPlaceRows
          keys={keys}
          variant="grid"
          content={effective}
          ready={!!trip && !!effective}
          renderPlace={(key) => {
            const summary = summarizePlace(trip, edit, effective, key);
            return summary ? (
              <PlaceTile
                summary={summary}
                onOpen={() => open(summary.placeKey)}
                onAdd={() => setDetail({ kind: 'add', placeKey: summary.placeKey })}
              />
            ) : null;
          }}
        />
      )}
      {keys.length === 0 && display === 'grid' && (
        <Typography sx={{ p: 2 }}>조건에 맞는 장소가 없어요</Typography>
      )}
    </Box>
  );
}
