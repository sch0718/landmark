import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { useAtomValue, useStore } from 'jotai';
import { useState } from 'react';
import { toast } from 'sonner';
import { detailFocusEnabled } from 'src/layouts/detail-focus';
import { LIMITS } from 'src/schema/common';
import { usePlaceActions } from 'src/sections/explore/store/use-place-actions';
import { ExploreFilters } from 'src/sections/explore/view/ExploreFilters';
import { PlaceCard } from 'src/sections/explore/view/PlaceCard';
import { dayLabel } from 'src/sections/itinerary/store/format';
import { reportSaveError } from 'src/sections/itinerary/store/itinerary-state';
import { StopEditPanel } from 'src/sections/itinerary/view/StopEditPanel';
import { detailAtom } from 'src/sections/views/store/view-session';
import { useTripStore } from 'src/stores/trip-store';
import CloseIcon from '~icons/mdi/close';

export function DetailSurface({ onClose, modal = true }: { onClose(): void; modal?: boolean }) {
  const detail = useAtomValue(detailAtom);
  const store = useStore();
  if (!detail) return null;
  const closeSession = () => {
    if (store.get(detailAtom) === detail) onClose();
  };
  const title =
    detail.kind === 'filter'
      ? '필터'
      : detail.kind === 'add'
        ? '일정에 추가'
        : detail.kind === 'stop'
          ? '방문 편집'
          : '장소 상세';
  return (
    <Box
      role="dialog"
      aria-label={title}
      aria-modal={modal ? true : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && detailFocusEnabled()) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          pt: 1,
        }}
      >
        <Typography component="h2" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <IconButton aria-label="닫기" onClick={onClose}>
          <CloseIcon width={22} height={22} />
        </IconButton>
      </Box>
      <Divider />
      {detail.kind === 'place' && <PlaceCard placeKey={detail.placeKey} />}
      {detail.kind === 'filter' && <ExploreFilters />}
      {detail.kind === 'add' && (
        <AddToDayPanel key={detail.placeKey} placeKey={detail.placeKey} onClose={closeSession} />
      )}
      {detail.kind === 'stop' && (
        <StopEditPanel date={detail.date} stopId={detail.stopId} onClose={closeSession} />
      )}
    </Box>
  );
}

function AddToDayPanel({ placeKey, onClose }: { placeKey: string; onClose(): void }) {
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const { addToDay } = usePlaceActions(placeKey);
  const [saving, setSaving] = useState(false);
  if (!trip || !Object.hasOwn(trip.places, placeKey))
    return <Typography sx={{ p: 2 }}>장소를 찾을 수 없어요</Typography>;
  const add = async (date: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await addToDay(date);
      if (result === 'saved') {
        onClose();
        toast.success('일정에 추가했어요');
      } else if (result === 'limit')
        toast.error(`하루에 ${LIMITS.stopsPerDay}곳까지 넣을 수 있어요`);
    } catch (e) {
      reportSaveError(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Box sx={{ p: 2 }}>
      <Typography sx={{ mb: 1 }}>{trip.places[placeKey]!.name}</Typography>
      {trip.days.map((day) => (
        <Button
          key={day.date}
          fullWidth
          disabled={saving}
          onClick={() => void add(day.date)}
          sx={{ justifyContent: 'flex-start', minHeight: 48 }}
        >
          {dayLabel(trip, day.date)}
        </Button>
      ))}
    </Box>
  );
}
