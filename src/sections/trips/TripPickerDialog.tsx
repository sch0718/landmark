import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { useAtomValue } from 'jotai';
import { useId, useMemo } from 'react';
import { liveTrips } from 'src/domain/trips/query';
import { periodLabel } from 'src/sections/trips/trip-dates';
import { libraryAtom } from 'src/stores/library-state';

type Props = {
  open: boolean;
  /** 고른 여행. 닫는 일은 부른 쪽이 한다. */
  onPick(tripId: string): void;
  /** `새 여행`을 눌렀을 때. */
  onCreateNew(): void;
  onClose(): void;
};

/**
 * 장소를 넣을 여행 고르기(스펙 §2.2의 2, 보관함 일괄 편집 바의 `여행에 넣기`).
 * 지워지지 않은 여행을 가까운 순으로(지난 여행은 뒤에) 보이고, 맨 위에 `새 여행`을 둔다.
 */
export function TripPickerDialog({ open, onPick, onCreateNew, onClose }: Props) {
  const library = useAtomValue(libraryAtom);
  const titleId = useId();
  const trips = useMemo(() => liveTrips(library), [library]);

  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId} fullWidth maxWidth="xs">
      <DialogTitle id={titleId}>여행에 넣기</DialogTitle>
      <DialogContent>
        <Button
          variant="outlined"
          fullWidth
          onClick={onCreateNew}
          sx={{ minHeight: 44, textTransform: 'none' }}
        >
          새 여행
        </Button>
        {trips.length === 0 ? (
          <Box sx={{ py: 3, textAlign: 'center', color: 'var(--tm-text-secondary)' }}>
            아직 만든 여행이 없어요
          </Box>
        ) : (
          <Box
            component="ul"
            aria-label="여행 목록"
            sx={{ m: 0, mt: 1.5, p: 0, borderTop: '1px solid var(--tm-border)' }}
          >
            {trips.map((trip) => (
              <Box
                component="li"
                key={trip.id}
                sx={{ listStyle: 'none', borderBottom: '1px solid var(--tm-border)' }}
              >
                <Box
                  component="button"
                  type="button"
                  onClick={() => onPick(trip.id)}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    justifyContent: 'center',
                    gap: 0.25,
                    width: '100%',
                    minHeight: 56,
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
                    {trip.title.value}
                  </Box>
                  <Box component="span" sx={{ fontSize: 12, color: 'var(--tm-text-secondary)' }}>
                    {periodLabel(trip.startDate.value, trip.endDate.value)}
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ minHeight: 44 }}>
          닫기
        </Button>
      </DialogActions>
    </Dialog>
  );
}
