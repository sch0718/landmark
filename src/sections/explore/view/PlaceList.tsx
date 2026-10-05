import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import ListItemButton from '@mui/material/ListItemButton';
import Typography from '@mui/material/Typography';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { mapFocusAtom } from 'src/sections/explore/store/explore-state';
import { useTripStore } from 'src/stores/trip-store';
import { detailAtom, selectedPlaceScrollRequestAtom } from 'src/sections/views/store/view-session';
import { summarizePlace } from '../store/place-summary';
import { selectedPlaceAtom } from 'src/stores/ui-store';
import { VirtualPlaceRows } from './VirtualPlaceRows';

export function PlaceList({ keys }: { keys: string[] }) {
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const edit = useAtomValue(ts.editLayerAtom);
  const effective = useAtomValue(ts.effectiveTripAtom);
  const [selected, setSelected] = useAtom(selectedPlaceAtom);
  const setFocus = useSetAtom(mapFocusAtom);
  const setDetail = useSetAtom(detailAtom);
  const setRequest = useSetAtom(selectedPlaceScrollRequestAtom);
  if (!trip || keys.length === 0)
    return (
      <>
        {trip && (
          <Typography sx={{ p: 2 }} color="text.secondary">
            조건에 맞는 장소가 없어요
          </Typography>
        )}
        <VirtualPlaceRows
          keys={[]}
          variant="list"
          content={effective ?? trip ?? ts}
          ready={!!trip && !!effective}
          renderPlace={() => null}
        />
      </>
    );

  return (
    <Box>
      <Typography variant="caption" sx={{ px: 1.5 }} color="text.secondary">
        {keys.length}곳
      </Typography>
      <VirtualPlaceRows
        keys={keys}
        variant="list"
        content={effective ?? trip}
        ready={!!trip && !!effective}
        renderPlace={(key) => {
          const place = trip.places[key];
          if (!place) return null;
          const isSelected = key === selected;
          const summary = effective ? summarizePlace(trip, edit, effective, key) : null;
          const hidden = edit?.places[key]?.hidden?.value ?? false;
          return (
            <Box>
              <ListItemButton
                selected={isSelected}
                aria-label={`${place.name} 상세`}
                aria-current={isSelected ? 'true' : undefined}
                onClick={() => {
                  setSelected(key);
                  setRequest((n) => n + 1);
                  setDetail({ kind: 'place', placeKey: key });
                  setFocus((f) => ({ point: [place.lng, place.lat], seq: (f?.seq ?? 0) + 1 }));
                }}
                sx={{ display: 'block' }}
              >
                <Typography component="span" sx={{ fontWeight: 600, display: 'block' }}>
                  {summary ? `${summary.emoji} ` : ''}
                  {place.name}
                </Typography>
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block' }}
                >
                  {place.category ?? '미분류'}
                  {hidden ? ' · 숨김' : ''}
                  {summary ? ` · 💬 ${summary.memoCount}` : ''}
                </Typography>
                {summary && (
                  <>
                    <Typography component="span" variant="caption" noWrap sx={{ display: 'block' }}>
                      {summary.memoPreview || '메모 없음'}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                      {summary.dayLabels.slice(0, 2).map((label) => (
                        <Chip key={label} size="small" label={label} />
                      ))}
                      {summary.dayLabels.length > 2 && (
                        <Typography variant="caption">+{summary.dayLabels.length - 2}</Typography>
                      )}
                    </Box>
                  </>
                )}
              </ListItemButton>
              <Button
                aria-label={`${place.name} 일정에 추가`}
                onClick={() => setDetail({ kind: 'add', placeKey: key })}
                sx={{ minHeight: 44 }}
              >
                일정에 추가
              </Button>
            </Box>
          );
        }}
      />
    </Box>
  );
}
