import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import FilterIcon from '~icons/mdi/filter-variant';
import { detailAtom } from 'src/sections/views/store/view-session';
import { useTripStore } from 'src/stores/trip-store';
import { searchQueryAtom } from 'src/stores/ui-store';
import { exploreFilterAtom } from '../store/explore-state';
import { categoryCounts, DEFAULT_FILTER } from '../store/filters';

export function FilterBar() {
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const edit = useAtomValue(ts.editLayerAtom);
  const [filter, setFilter] = useAtom(exploreFilterAtom);
  const [query, setQuery] = useAtom(searchQueryAtom);
  const setDetail = useSetAtom(detailAtom);
  if (!trip) return null;
  const count =
    filter.folderIds.length +
    filter.categories.length +
    filter.tags.length +
    Number(filter.hasMemo) +
    Number(filter.inItinerary !== 'any') +
    Number(filter.showHidden) +
    Number(filter.inViewOnly) +
    Number(query.trim().length > 0);
  return (
    <Box sx={{ display: 'flex', gap: 0.75, p: 1, overflowX: 'auto', alignItems: 'center' }}>
      {categoryCounts(trip, edit, filter.categories)
        .filter(({ category }, i) => i < 3 || filter.categories.includes(category))
        .map(({ category }) => (
          <Chip
            key={category}
            label={category}
            aria-pressed={filter.categories.includes(category)}
            color={filter.categories.includes(category) ? 'primary' : 'default'}
            onClick={() =>
              setFilter((f) => ({
                ...f,
                categories: f.categories.includes(category)
                  ? f.categories.filter((c) => c !== category)
                  : [...f.categories, category],
              }))
            }
          />
        ))}
      <Button
        startIcon={<FilterIcon width={20} height={20} />}
        sx={{ flexShrink: 0 }}
        onClick={() => setDetail({ kind: 'filter' })}
      >
        필터{count > 0 ? ` ${count}` : ''}
      </Button>
      {count > 0 && (
        <Button
          sx={{ flexShrink: 0 }}
          onClick={() => {
            setFilter({ ...DEFAULT_FILTER });
            setQuery('');
          }}
        >
          모두 해제
        </Button>
      )}
    </Box>
  );
}
