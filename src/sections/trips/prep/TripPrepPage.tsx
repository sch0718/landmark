import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useAtomValue } from 'jotai';
import { useCallback, useId, useRef } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { XIcon } from 'src/components/icons';
import { loadVoices } from 'src/lib/speak';
import { useDocumentTitle } from 'src/lib/use-document-title';
import { paths } from 'src/routes/paths';
import type { Library } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';
import { TripNotFound } from 'src/sections/trips/TripNotFound';
import { libraryAtom } from 'src/stores/library-state';
import { BookingsTab } from './BookingsTab';
import { NotesTab } from './NotesTab';
import { PhrasesTab } from './PhrasesTab';

const tabs = [
  ['bookings', '예약'],
  ['info', '정보'],
  ['phrases', '문장'],
] as const;
type PrepTab = (typeof tabs)[number][0];

function Prep({ trip, library }: { trip: Trip; library: Library }) {
  const tabId = useId();
  const voiceRequest = useRef<Promise<SpeechSynthesisVoice[]> | null>(null);
  const requestVoices = useCallback(
    () =>
      (voiceRequest.current ??= loadVoices()
        .catch(() => [])
        .then((voices) => {
          // 2초 안에 목록이 오지 않았으면 다음에 문장 탭을 열 때 다시 묻는다.
          if (voices.length === 0) voiceRequest.current = null;
          return voices;
        })),
    [],
  );
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab = requested === 'info' || requested === 'phrases' ? requested : 'bookings';

  function selectTab(next: PrepTab) {
    const query = new URLSearchParams(params);
    if (next === 'bookings') query.delete('tab');
    else query.set('tab', next);
    setParams(query, { replace: true });
  }

  return (
    <Stack sx={{ maxWidth: 760, mx: 'auto', px: { xs: 2, sm: 3 }, py: 2, gap: 2.5 }}>
      <Stack component="header" direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <Typography
          component="h1"
          sx={{ flex: 1, minWidth: 0, fontSize: 20, fontWeight: 800, overflowWrap: 'anywhere' }}
        >
          {trip.title.value} · 준비
        </Typography>
        <IconButton
          component={Link}
          to={paths.trip(trip.id)}
          aria-label="준비 닫기"
          sx={{ width: 44, height: 44 }}
        >
          <XIcon aria-hidden="true" width={22} height={22} />
        </IconButton>
      </Stack>

      <Tabs
        aria-label="여행 준비"
        variant="fullWidth"
        value={tab}
        onChange={(_, next: PrepTab) => selectTab(next)}
      >
        {tabs.map(([value, label]) => (
          <Tab key={value} id={tabId + value} value={value} label={label} sx={{ minHeight: 44 }} />
        ))}
      </Tabs>
      <Box role="tabpanel" aria-labelledby={tabId + tab} tabIndex={0}>
        {tab === 'bookings' && <BookingsTab trip={trip} library={library} />}
        {tab === 'info' && <NotesTab trip={trip} />}
        {tab === 'phrases' && <PhrasesTab trip={trip} requestVoices={requestVoices} />}
      </Box>
    </Stack>
  );
}

export function TripPrepPage() {
  const { id = '' } = useParams();
  const library = useAtomValue(libraryAtom);
  const trip = library.trips[id];
  const found = trip !== undefined && trip.deletedAt === null;
  useDocumentTitle(found ? `${trip.title.value} · 준비` : null);
  if (!found) return <TripNotFound />;
  return <Prep key={trip.id} trip={trip} library={library} />;
}
