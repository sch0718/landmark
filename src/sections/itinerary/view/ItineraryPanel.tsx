import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useState } from 'react';
import { dayTotals } from 'src/domain/day-totals';
import { planRevert } from 'src/domain/revert';
import { naverPlaceUrl } from 'src/models/place';
import type { TripData } from 'src/schema/trip-data';
import { dayLabel } from 'src/sections/itinerary/store/format';
import {
  candidateLayerAtom,
  reportSaveError,
  useItineraryDays,
  type ItineraryDay,
} from 'src/sections/itinerary/store/itinerary-state';
import { revertMessage } from 'src/sections/itinerary/store/revert-message';
import { itineraryEditingAtom, mobileRouteMapAtom } from 'src/sections/views/store/view-session';
import { useTripStore } from 'src/stores/trip-store';
import { selectedDayAtom } from 'src/stores/ui-store';
import { DayTabs } from './DayTabs';
import { DayTotals } from './DayTotals';
import { RevertDialog } from './RevertDialog';
import { Timeline } from './Timeline';

type PendingRevert = { dates: string[]; message: string };

/** 일정 모드 패널: Day 탭, 후보 레이어 토글, 날짜별 타임라인·합계, 되돌리기, 작성자 안내. */
export function ItineraryPanel() {
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const edit = useAtomValue(ts.editLayerAtom);
  const selected = useAtomValue(selectedDayAtom);
  const [showCandidates, setShowCandidates] = useAtom(candidateLayerAtom);
  const revertGroup = useSetAtom(ts.revertGroupAtom);
  const days = useItineraryDays();
  const [pending, setPending] = useState<PendingRevert | null>(null);
  if (!trip) return null;

  const visible = selected === 'all' ? days : days.filter((d) => d.day.date === selected);
  const needsRecalc = days.some(
    (d) => d.day.source === 'override' && d.legs.some((l) => l.status !== 'routed'),
  );

  const startRevert = (date: string) => {
    if (!edit) return;
    const { dates } = planRevert(trip, edit, date);
    if (dates.length <= 1) {
      revertGroup([date]).catch(reportSaveError);
      return;
    }
    setPending({ dates, message: revertMessage(trip, edit, dates, date) });
  };

  return (
    <Box data-testid="itinerary-panel">
      <DayTabs trip={trip} />
      <Box sx={{ px: 2, pt: 1 }}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={showCandidates}
              onChange={(e) => setShowCandidates(e.target.checked)}
            />
          }
          label="후보 장소 보기"
        />
      </Box>
      <Stack divider={<Divider flexItem />} spacing={2} sx={{ p: 2 }}>
        {visible.map((item) => (
          <DaySection
            key={item.day.date}
            trip={trip}
            item={item}
            onRevert={startRevert}
            selected={selected === item.day.date}
          />
        ))}
      </Stack>
      {needsRecalc && (
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="author-hint"
          sx={{ px: 2, pb: 2 }}
        >
          재계산하려면 편집을 파일로 내보내 <code>apply-edit</code>을 실행하세요
        </Typography>
      )}
      <RevertDialog
        open={pending !== null}
        message={pending?.message ?? ''}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) revertGroup(pending.dates).catch(reportSaveError);
          setPending(null);
        }}
      />
    </Box>
  );
}

type SectionProps = {
  trip: TripData;
  item: ItineraryDay;
  onRevert(date: string): void;
  selected: boolean;
};

function DaySection({ trip, item, onRevert, selected }: SectionProps) {
  const { day, legs } = item;
  const [editing, setEditing] = useAtom(itineraryEditingAtom);
  const [showMap, setShowMap] = useAtom(mobileRouteMapAtom);
  const first = selected ? day.stops[0] : undefined;
  const place = first ? trip.places[first.placeKey] : undefined;
  const url = place ? naverPlaceUrl(place) : null;
  return (
    <Box component="section" aria-label={dayLabel(trip, day.date)}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
          {dayLabel(trip, day.date)}
        </Typography>
        <Button
          size="small"
          aria-label={editing ? '일정 편집 완료' : '일정 편집'}
          onClick={() => setEditing(!editing)}
        >
          {editing ? '완료' : '편집'}
        </Button>
        {day.source === 'override' && (
          <Button size="small" color="warning" onClick={() => onRevert(day.date)}>
            원본 일정으로 되돌리기
          </Button>
        )}
      </Stack>
      <Button size="small" onClick={() => setShowMap(!showMap)}>
        {showMap ? '동선 지도 접기' : '동선 지도 보기'}
      </Button>
      {first && place && (
        <Box sx={{ py: 1 }}>
          <Typography variant="caption" color="text.secondary">
            첫 번째 방문
          </Typography>
          <Typography variant="body2">
            {first.time ? `${first.time} · ` : ''}
            {place.name}
          </Typography>
          {url && (
            <Button size="small" href={url} target="_blank" rel="noopener noreferrer">
              네이버에서 보기
            </Button>
          )}
        </Box>
      )}
      <Timeline trip={trip} item={item} />
      {legs.length > 0 && <DayTotals totals={dayTotals(legs)} />}
    </Box>
  );
}
