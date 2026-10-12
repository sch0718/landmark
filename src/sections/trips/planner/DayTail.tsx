import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import { useState } from 'react';
import { LabelGlyph } from 'src/components/icons';
import { formatClock, type DaySchedule } from 'src/domain/trips/schedule';
import type { Place } from 'src/schema/library';
import { formatTotals, queriedLabel } from 'src/sections/trips/planner/format';
import { PlacePickerDialog } from 'src/sections/trips/PlacePickerDialog';

type Props = {
  tripId: string;
  /** 마지막 Day면 `다음 날들도 같은 숙소`를 보이지 않는다. */
  isLastDay: boolean;
  /** 그날 숙소(도착점). 없으면 `숙소 정하기`. */
  lodging: Place | null;
  /** 숙소에 닿는 시각(분). 숙소가 없으면 null. */
  lodgingArriveMin: number | null;
  /** 보이는 구간이 하나라도 있는가. 없으면 합계·다시 계산을 숨긴다. */
  hasLegs: boolean;
  totals: DaySchedule['totals'];
  oldestQueriedAt: string | null;
  onLodging(placeId: string, alsoFollowingDays: boolean): void;
  onRefresh(): void;
};

/** Day 꼬리: 숙소(또는 `숙소 정하기`), 그날 합계, `<M>월 <D>일 조회 · 다시 계산`. */
export function DayTail({
  tripId,
  isLastDay,
  lodging,
  lodgingArriveMin,
  hasLegs,
  totals,
  oldestQueriedAt,
  onLodging,
  onRefresh,
}: Props) {
  const [picking, setPicking] = useState(false);
  const [alsoFollowing, setAlsoFollowing] = useState(false);
  const openPicker = () => {
    setAlsoFollowing(false); // 열 때마다 기본은 끔
    setPicking(true);
  };

  return (
    <Box sx={{ px: 2, py: 1, borderTop: '1px solid var(--tm-border)' }}>
      {lodging === null ? (
        <Button variant="outlined" onClick={openPicker} sx={{ minHeight: 44 }}>
          숙소 정하기
        </Button>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 44 }}>
          <Box sx={{ flex: 'none', display: 'flex', color: 'var(--tm-text-secondary)' }}>
            <LabelGlyph name="bed" size={18} />
          </Box>
          {lodgingArriveMin !== null && (
            <Box
              component="span"
              sx={{ flex: 'none', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}
            >
              {formatClock(lodgingArriveMin)}
            </Box>
          )}
          <Box
            component="span"
            sx={{ flex: 1, minWidth: 0, fontWeight: 700, overflowWrap: 'anywhere' }}
          >
            {lodging.name.value}
          </Box>
          <Button size="small" onClick={openPicker} aria-label="숙소 바꾸기" sx={{ minHeight: 44 }}>
            바꾸기
          </Button>
        </Box>
      )}

      {hasLegs && <Box sx={{ mt: 1, fontSize: 14, fontWeight: 700 }}>{formatTotals(totals)}</Box>}
      {hasLegs && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            fontSize: 13,
            color: 'var(--tm-text-secondary)',
          }}
        >
          {oldestQueriedAt !== null && (
            <>
              <span>{queriedLabel(oldestQueriedAt)}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <Button size="small" onClick={onRefresh} sx={{ minHeight: 44 }}>
            다시 계산
          </Button>
        </Box>
      )}

      <PlacePickerDialog
        open={picking}
        title="숙소 정하기"
        tripId={tripId}
        onClose={() => setPicking(false)}
        onPick={(placeId) => {
          setPicking(false);
          onLodging(placeId, alsoFollowing);
        }}
        extra={
          isLastDay ? undefined : (
            <FormControlLabel
              control={
                <Checkbox
                  checked={alsoFollowing}
                  onChange={(event) => setAlsoFollowing(event.target.checked)}
                />
              }
              label="다음 날들도 같은 숙소"
              sx={{ minHeight: 44 }}
            />
          )
        }
      />
    </Box>
  );
}
