import Box from '@mui/material/Box';
import ListItemButton from '@mui/material/ListItemButton';
import Typography from '@mui/material/Typography';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { mapFocusAtom } from 'src/sections/explore/store/explore-state';
import { PlaceCard } from 'src/sections/explore/view/PlaceCard';
import { useTripStore } from 'src/stores/trip-store';
import { selectedPlaceAtom } from 'src/stores/ui-store';

export function PlaceList({ keys }: { keys: string[] }) {
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const edit = useAtomValue(ts.editLayerAtom);
  const [selected, setSelected] = useAtom(selectedPlaceAtom);
  const setFocus = useSetAtom(mapFocusAtom);
  const rows = useRef(new Map<string, HTMLElement>());

  // 마커 클릭 등으로 선택이 바뀌면 해당 항목이 보이게 스크롤한다.
  useEffect(() => {
    if (selected) rows.current.get(selected)?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  if (!trip) return null;
  if (keys.length === 0) {
    return (
      <Typography sx={{ p: 2 }} color="text.secondary">
        조건에 맞는 장소가 없어요
      </Typography>
    );
  }

  return (
    <Box>
      <Typography variant="caption" sx={{ px: 1.5 }} color="text.secondary">
        {keys.length}곳
      </Typography>
      <Box component="ul" aria-label="장소 목록" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {keys.map((key) => {
          const place = trip.places[key];
          if (!place) return null;
          const isSelected = key === selected;
          const hidden = edit?.places[key]?.hidden?.value ?? false;
          return (
            <Box
              component="li"
              key={key}
              ref={(el: HTMLElement | null) => {
                if (el) rows.current.set(key, el);
                else rows.current.delete(key);
              }}
            >
              <ListItemButton
                selected={isSelected}
                aria-current={isSelected ? 'true' : undefined}
                onClick={() => {
                  setSelected(key);
                  setFocus((f) => ({ point: [place.lng, place.lat], seq: (f?.seq ?? 0) + 1 }));
                }}
                sx={{ display: 'block' }}
              >
                <Typography component="span" sx={{ fontWeight: 600, display: 'block' }}>
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
                </Typography>
              </ListItemButton>
              {isSelected && <PlaceCard placeKey={key} />}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
