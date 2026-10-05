import AppBar from '@mui/material/AppBar';
import IconButton from '@mui/material/IconButton';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import SearchIcon from '~icons/mdi/magnify';
import MoreIcon from '~icons/mdi/dots-horizontal';
import { useTripStore } from 'src/stores/trip-store';
import { viewModeAtom } from 'src/stores/ui-store';
import { TripShareControls } from './TripShareControls';
import { itineraryEditingAtom, searchFocusRequestedAtom } from '../store/view-session';

export function TripToolbar() {
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const store = useStore();
  const setView = useSetAtom(viewModeAtom);
  const setEditing = useSetAtom(itineraryEditingAtom);
  const search = () => {
    store.set(searchFocusRequestedAtom, true);
    setEditing(false);
    setView('places');
    requestAnimationFrame(() => {
      if (!store.get(searchFocusRequestedAtom)) return;
      const input = document.querySelector<HTMLInputElement>('[data-trip-search]');
      if (input) {
        input.focus();
        if (document.activeElement === input) store.set(searchFocusRequestedAtom, false);
      }
    });
  };
  return (
    <AppBar position="static" color="default" elevation={1}>
      <Toolbar variant="dense" sx={{ gap: 0.5, minHeight: 56, flexWrap: 'nowrap' }}>
        <Typography component="h1" noWrap sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}>
          {trip?.title}
        </Typography>
        <IconButton aria-label="검색" onClick={search}>
          <SearchIcon width={22} height={22} />
        </IconButton>
        <TripShareControls icon={<MoreIcon width={22} height={22} />} />
      </Toolbar>
    </AppBar>
  );
}
