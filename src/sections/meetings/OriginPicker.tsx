import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import { Effect } from 'effect';
import { useAtomValue } from 'jotai';
import { useEffect, useId, useState } from 'react';
import { MapView } from 'src/components/map/MapView';
import { searchPlaces } from 'src/domain/library/query';
import { startEffect } from 'src/lib/effect/runtime';
import { OriginSchema, type Origin } from 'src/schema/meeting';
import { safeParse } from 'src/schema/parse';
import { MapPickOverlay } from 'src/sections/meetings/MapPickOverlay';
import { PlaceSearch, type SearchResult } from 'src/services/place-search';
import { libraryAtom } from 'src/stores/library-state';

type Props = {
  open: boolean;
  origin?: Origin | null;
  onPick(origin: Origin): void;
  onClose(): void;
};
const validOrigin = (origin: Origin) => safeParse(OriginSchema, origin).success;
const searchError = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'OFFLINE'
    ? '오프라인이에요'
    : '검색이 안 돼요 — 지도 핀이나 보관함 장소를 써 주세요';

/** 열 때마다 새 세션으로 시작하므로 닫힌 창의 늦은 요청을 되살리지 않는다. */
function PickerContent({ origin, onPick, onClose, id }: Omit<Props, 'open'> & { id: string }) {
  const library = useAtomValue(libraryAtom);
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState('');
  const [mineQuery, setMineQuery] = useState('');
  const [name, setName] = useState(origin?.name ?? '지도에서 고른 곳');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const q = query.trim().replace(/\s+/g, ' ');
    if (tab !== 0 || q.length === 0 || q.length > 40) return;
    const timer = setTimeout(() => {
      setLoading(true);
      void startEffect(Effect.flatMap(PlaceSearch, (service) => service.search(q))).then(
        (found) => {
          if (!active) return;
          setResults(
            found.filter((place) =>
              validOrigin({ name: place.name, lng: place.lng, lat: place.lat }),
            ),
          );
          setLoading(false);
        },
        (failure: unknown) => {
          if (!active) return;
          setError(searchError(failure));
          setLoading(false);
        },
      );
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, tab]);
  const pick = (value: Origin) => {
    if (validOrigin(value)) onPick(value);
  };
  const places = searchPlaces(library, mineQuery).filter((place) =>
    validOrigin({ name: place.name.value, lng: place.lng, lat: place.lat, placeId: place.id }),
  );
  return (
    <>
      <Tabs
        value={tab}
        onChange={(_, next: number) => {
          setTab(next);
          setResults([]);
          setError(null);
          setLoading(false);
        }}
        variant="fullWidth"
        aria-label="출발지 선택 방법"
      >
        {['검색', '지도에서 고르기', '보관함에서'].map((label, index) => (
          <Tab
            key={label}
            id={`${id}-tab-${index}`}
            aria-controls={`${id}-panel-${index}`}
            label={index === 1 ? '지도에서' : label}
            aria-label={label}
            sx={{ minHeight: 44, minWidth: 0, px: 0.5 }}
          />
        ))}
      </Tabs>
      <Box
        role="tabpanel"
        id={`${id}-panel-${tab}`}
        aria-labelledby={`${id}-tab-${tab}`}
        sx={{ pt: 2 }}
      >
        {tab === 0 && (
          <>
            <TextField
              autoFocus
              type="search"
              label="출발지 검색"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setResults([]);
                setError(null);
                setLoading(false);
              }}
              fullWidth
              helperText={
                query.trim().length > 40 ? '검색어는 40자까지예요' : '장소 이름으로 찾아보세요'
              }
            />
            {loading && (
              <Box role="status" sx={{ py: 2 }}>
                찾는 중이에요
              </Box>
            )}
            {error !== null && (
              <Box role="alert" sx={{ py: 2 }}>
                {error}
              </Box>
            )}
            <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
              {results.map((result, index) => (
                <Box component="li" key={`${result.lng}:${result.lat}:${index}`}>
                  <Button
                    aria-label={`${result.name} ${result.address} ${result.category}`}
                    onClick={() => pick({ name: result.name, lng: result.lng, lat: result.lat })}
                    sx={{
                      minHeight: 56,
                      width: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      textAlign: 'left',
                    }}
                  >
                    <Box component="span" sx={{ fontWeight: 700 }}>
                      {result.name}
                    </Box>
                    <Box component="span">{result.address}</Box>
                    <Box component="span" sx={{ fontSize: 12 }}>
                      {result.category}
                    </Box>
                  </Button>
                </Box>
              ))}
            </Box>
          </>
        )}
        {tab === 1 && (
          <>
            <TextField
              label="출발지 이름"
              value={name}
              onChange={(event) => setName(event.target.value)}
              fullWidth
              error={name.trim().length === 0 || name.trim().length > 60}
              helperText="이름은 1~60자로 넣어 주세요"
            />
            <Box sx={{ mt: 1, height: 320, position: 'relative', bgcolor: 'var(--tm-bg-raised)' }}>
              <MapView
                markers={[]}
                polylines={[]}
                onMarkerClick={() => {}}
                onCenterChange={setCenter}
                onReadyChange={setReady}
                onUnavailable={(reason) => {
                  setMapError(reason);
                  setReady(false);
                }}
                extraFitPoints={
                  origin === undefined || origin === null ? [] : [[origin.lng, origin.lat]]
                }
              />
              {mapError !== null && (
                <Box
                  role="status"
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    p: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {mapError}
                </Box>
              )}
              <MapPickOverlay
                center={ready && name.trim().length > 0 && name.trim().length <= 60 ? center : null}
                onCancel={onClose}
                onPick={([lng, lat]) => pick({ name: name.trim(), lng, lat })}
              />
            </Box>
          </>
        )}
        {tab === 2 && (
          <>
            <TextField
              autoFocus
              type="search"
              label="보관함 장소 검색"
              value={mineQuery}
              onChange={(event) => setMineQuery(event.target.value)}
              fullWidth
            />
            {places.length === 0 && (
              <Box sx={{ py: 3, textAlign: 'center' }}>찾는 장소가 없어요</Box>
            )}
            <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
              {places.slice(0, 50).map((place) => (
                <Box component="li" key={place.id}>
                  <Button
                    onClick={() =>
                      pick({
                        name: place.name.value,
                        lng: place.lng,
                        lat: place.lat,
                        placeId: place.id,
                      })
                    }
                    sx={{
                      minHeight: 56,
                      width: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      textAlign: 'left',
                    }}
                  >
                    <Box component="span" sx={{ fontWeight: 700 }}>
                      {place.name.value}
                    </Box>
                    <Box component="span">{place.address}</Box>
                  </Button>
                </Box>
              ))}
            </Box>
            {places.length > 50 && (
              <Box sx={{ fontSize: 12 }}>50곳까지만 보여요. 검색어를 더 넣어 보세요.</Box>
            )}
          </>
        )}
      </Box>
    </>
  );
}

/** 검색·지도·보관함을 한 창에서 고른다. 보관함에는 쓰지 않는다. */
export function OriginPicker({ open, origin, onPick, onClose }: Props) {
  const id = useId();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby={id}
      fullWidth
      maxWidth="sm"
      sx={{ '& .MuiDialog-container': { alignItems: 'flex-start' } }}
    >
      <DialogTitle id={id}>출발지 고르기</DialogTitle>
      <DialogContent>
        {open && <PickerContent origin={origin} onPick={onPick} onClose={onClose} id={id} />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ minHeight: 44 }}>
          닫기
        </Button>
      </DialogActions>
    </Dialog>
  );
}
