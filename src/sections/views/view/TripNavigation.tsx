import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MapIcon from '~icons/mdi/map-outline';
import RouteIcon from '~icons/mdi/routes';
import PlacesIcon from '~icons/mdi/bookmark-multiple-outline';
import { useAtom, useSetAtom } from 'jotai';
import { VIEW_TOKENS } from 'src/theme/view-tokens';
import { viewModeAtom } from 'src/stores/ui-store';
import { itineraryEditingAtom } from '../store/view-session';

const items = [
  { view: 'map', label: '지도', Icon: MapIcon },
  { view: 'day', label: '일정', Icon: RouteIcon },
  { view: 'places', label: '장소', Icon: PlacesIcon },
] as const;

export function TripNavigation({ orientation }: { orientation: 'horizontal' | 'vertical' }) {
  const [view, setView] = useAtom(viewModeAtom);
  const setEditing = useSetAtom(itineraryEditingAtom);
  const tokens = VIEW_TOKENS[view];

  return (
    <Box
      component="nav"
      aria-label="보기 전환"
      sx={{
        display: 'flex',
        flexDirection: orientation === 'vertical' ? 'column' : 'row',
        gap: 1,
        p: 1,
        bgcolor: tokens.surface,
      }}
    >
      {items.map(({ view: value, label, Icon }) => (
        <Button
          key={value}
          aria-pressed={view === value}
          onClick={() => {
            if (value !== view) setEditing(false);
            setView(value);
          }}
          sx={{
            minWidth: 44,
            minHeight: 44,
            flex: orientation === 'horizontal' ? 1 : undefined,
            flexDirection: 'column',
            gap: 0.5,
            color: view === value ? tokens.accent : '#65767b',
            bgcolor: view === value ? tokens.soft : 'transparent',
            borderRadius: 2,
          }}
        >
          <Icon width={22} height={22} />
          {label}
        </Button>
      ))}
    </Box>
  );
}
