import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { useAtomValue } from 'jotai';
import { useDeferredValue, useId, useMemo, useState, type ReactNode } from 'react';
import { fieldSx } from 'src/components/field-style';
import { searchPlaces } from 'src/domain/library/query';
import type { Library, Place } from 'src/schema/library';
import { libraryAtom } from 'src/stores/library-state';

type Props = {
  open: boolean;
  title: string;
  /** 주어지면 이 여행의 장소(후보·Day의 장소)를 보관함 검색 결과보다 먼저 보인다. */
  tripId?: string;
  onPick(placeId: string): void;
  onClose(): void;
  /** 목록 위에 끼워 넣는 추가 조작(예: "다음 날들도 같은 숙소"). */
  extra?: ReactNode;
};

/** 보관함 결과를 너무 많이 그리지 않도록 자르는 개수. 더 보려면 검색어를 좁힌다. */
const MAX_LIBRARY_ROWS = 50;

/** 이 여행의 장소 id: 후보 → Day 순서(Day 안은 자리 순서), 중복 없이. */
function tripPlaceIds(lib: Library, tripId: string | undefined): string[] {
  const trip = tripId === undefined ? undefined : lib.trips[tripId];
  if (trip === undefined) return [];
  const ids = new Set<string>(trip.candidates.value);
  for (const day of trip.days) for (const stop of day.stops.value) ids.add(stop.placeId);
  return [...ids];
}

function PlaceButton({ place, onPick }: { place: Place; onPick(id: string): void }) {
  return (
    <Box component="li" sx={{ listStyle: 'none', borderBottom: '1px solid var(--tm-border)' }}>
      <Box
        component="button"
        type="button"
        onClick={() => onPick(place.id)}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 0.25,
          width: '100%',
          minHeight: 56,
          justifyContent: 'center',
          px: 0.5,
          py: 1,
          boxSizing: 'border-box',
          border: 0,
          background: 'transparent',
          font: 'inherit',
          color: 'var(--tm-text-primary)',
          textAlign: 'left',
          cursor: 'pointer',
          '&:focus-visible': { outlineOffset: -2 },
        }}
      >
        <Box component="span" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
          {place.name.value}
        </Box>
        {place.address !== '' && (
          <Box
            component="span"
            sx={{ fontSize: 12, color: 'var(--tm-text-secondary)', overflowWrap: 'anywhere' }}
          >
            {place.address}
          </Box>
        )}
      </Box>
    </Box>
  );
}

function Section({
  heading,
  places,
  onPick,
}: {
  heading: string;
  places: Place[];
  onPick(id: string): void;
}) {
  if (places.length === 0) return null;
  return (
    <Box component="section" sx={{ mt: 1.5 }}>
      <Box component="h3" sx={{ m: 0, mb: 0.5, fontSize: 13, color: 'var(--tm-text-secondary)' }}>
        {heading}
      </Box>
      <Box component="ul" sx={{ m: 0, p: 0, borderTop: '1px solid var(--tm-border)' }}>
        {places.map((place) => (
          <PlaceButton key={place.id} place={place} onPick={onPick} />
        ))}
      </Box>
    </Box>
  );
}

/**
 * 장소 하나를 고르는 창(출발지·숙소). 이 여행의 장소가 먼저, 그다음 보관함 전체를 이름·주소로 찾는다.
 * 보관함 목록에서 숨긴(`saved: false`) 장소도 나오고 지운 장소는 나오지 않는다. 닫는 일은 부른 쪽이 한다.
 */
export function PlacePickerDialog({ open, title, tripId, onPick, onClose, extra }: Props) {
  const library = useAtomValue(libraryAtom);
  const [text, setText] = useState('');
  const deferred = useDeferredValue(text);
  const titleId = useId();

  const { mine, rest, truncated } = useMemo(() => {
    const found = searchPlaces(library, deferred);
    const order = new Map(tripPlaceIds(library, tripId).map((id, i) => [id, i]));
    const inTrip = found
      .filter((p) => order.has(p.id))
      .sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const others = found.filter((p) => !order.has(p.id));
    return {
      mine: inTrip,
      rest: others.slice(0, MAX_LIBRARY_ROWS),
      truncated: others.length > MAX_LIBRARY_ROWS,
    };
  }, [library, deferred, tripId]);

  const handleClose = () => {
    setText('');
    onClose();
  };
  const handlePick = (id: string) => {
    setText('');
    onPick(id);
  };

  return (
    <Dialog open={open} onClose={handleClose} aria-labelledby={titleId} fullWidth maxWidth="xs">
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent>
        <Box
          component="input"
          type="search"
          aria-label="장소 검색"
          placeholder="이름이나 주소로 찾기"
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value)}
          sx={fieldSx()}
        />
        {extra !== undefined && <Box sx={{ mt: 1 }}>{extra}</Box>}
        {mine.length === 0 && rest.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center', color: 'var(--tm-text-secondary)' }}>
            찾는 장소가 없어요
          </Box>
        ) : (
          <>
            <Section heading="이 여행의 장소" places={mine} onPick={handlePick} />
            <Section heading="보관함" places={rest} onPick={handlePick} />
            {truncated && (
              <Box sx={{ mt: 1, fontSize: 12, color: 'var(--tm-text-muted)' }}>
                {`${MAX_LIBRARY_ROWS}곳까지만 보여요. 검색어를 더 넣어 보세요.`}
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} sx={{ minHeight: 44 }}>
          닫기
        </Button>
      </DialogActions>
    </Dialog>
  );
}
