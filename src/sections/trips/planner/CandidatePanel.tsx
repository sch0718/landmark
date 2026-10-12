import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import { useAtomValue, useSetAtom } from 'jotai';
import { useMemo } from 'react';
import { PanelLeftCloseIcon, PlusIcon } from 'src/components/icons';
import { liveLabels } from 'src/domain/library/query';
import { regionsByPlace } from 'src/domain/library/region';
import { insertStop } from 'src/domain/trips/ops';
import { visibleCandidates } from 'src/domain/trips/query';
import type { Label, Place } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';
import { labelColors } from 'src/sections/library/label-style';
import { placeLabels } from 'src/sections/library/place-labels';
import { objectParticle } from 'src/sections/trips/planner/format';
import { periodLabel } from 'src/sections/trips/trip-dates';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';
import { mapCardAtom } from 'src/stores/trip-planner';

function CandidateRow({
  place,
  region,
  label,
  dayIndex,
  onAdd,
  onOpen,
}: {
  place: Place;
  region: string;
  label: Label | undefined;
  dayIndex: number;
  onAdd(): void;
  /** 행을 누르면 지도 위 카드를 연다. */
  onOpen(): void;
}) {
  const name = place.name.value;
  return (
    <Box
      component="li"
      sx={{
        listStyle: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        minHeight: 56,
        pl: 2,
        pr: 0.5,
        borderBottom: '1px solid var(--tm-border)',
      }}
    >
      {/* 대표 라벨 색. 라벨이 없으면 자리만 둔다. */}
      <Box
        {...(label === undefined
          ? { 'aria-hidden': true }
          : { role: 'img', 'aria-label': label.name.value })}
        sx={{
          flex: 'none',
          width: 10,
          height: 10,
          borderRadius: '50%',
          bgcolor: label === undefined ? 'transparent' : labelColors(label.color.value).marker,
        }}
      />
      <Box
        component="button"
        type="button"
        onClick={onOpen}
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 44,
          display: 'block',
          p: 0,
          border: 0,
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
          borderRadius: 'var(--tm-radius-sm)',
          '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: 2 },
        }}
      >
        <Box
          component="span"
          sx={{
            display: 'block',
            fontWeight: 700,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </Box>
        <Box
          component="span"
          sx={{ display: 'block', fontSize: 12, color: 'var(--tm-text-secondary)' }}
        >
          {region}
        </Box>
      </Box>
      <IconButton
        aria-label={`${name}${objectParticle(name)} Day ${dayIndex + 1}에 넣기`}
        onClick={onAdd}
        sx={{ flex: 'none', width: 44, height: 44 }}
      >
        <PlusIcon aria-hidden="true" width={20} height={20} />
      </IconButton>
    </Box>
  );
}

type Props = {
  trip: Trip;
  /** `＋`가 넣을 Day(지금 보는 Day). */
  dayIndex: number;
  /** 주어지면(중간 폭) 머리에 `후보 칸 접기` 버튼을 둔다. */
  onCollapse?: () => void;
  /** 칸 높이를 채우고 목록만 스크롤한다(넓은·중간 폭). 끄면(시트) 내용 높이대로 늘고 바깥이 스크롤한다. */
  fill?: boolean;
};

/**
 * 후보 칸(스펙 §2.3): 여행 제목·기간, `후보 N`, 후보 행(이름·지역·대표 라벨 색, `＋`로 지금 Day 끝에 넣기).
 * 아래의 `보관함에서 더하기`·`링크·핀으로 새로 추가`·`Day 자동 나누기`는 Task 12·13에서 동작한다(지금은 비활성).
 */
export function CandidatePanel({ trip, dayIndex, onCollapse, fill = true }: Props) {
  const library = useAtomValue(libraryAtom);
  const { run } = useLibraryAction();
  const openCard = useSetAtom(mapCardAtom);

  const { candidates, regions, labelById } = useMemo(() => {
    const places = visibleCandidates(library, trip);
    return {
      candidates: places,
      regions: regionsByPlace(places),
      labelById: new Map(liveLabels(library).map((l) => [l.id, l])),
    };
  }, [library, trip]);

  const add = (placeId: string) =>
    void run((lib, ctx) => {
      // 끝 자리는 저장 직전의 최신본 기준으로 정한다.
      const end = lib.trips[trip.id]?.days[dayIndex]?.stops.value.length ?? 0;
      return insertStop(lib, trip.id, placeId, dayIndex, end, ctx);
    });

  return (
    <Box
      component="section"
      aria-label="후보 칸"
      sx={{
        ...(fill ? { height: '100%', minHeight: 0 } : {}),
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box sx={{ flex: 'none', display: 'flex', alignItems: 'flex-start', gap: 1, px: 2, pt: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box
            component="h1"
            sx={{ m: 0, fontSize: 18, fontWeight: 800, overflowWrap: 'anywhere' }}
          >
            {trip.title.value}
          </Box>
          <Box sx={{ mt: 0.25, fontSize: 13, color: 'var(--tm-text-secondary)' }}>
            {periodLabel(trip.startDate.value, trip.endDate.value)}
          </Box>
        </Box>
        {onCollapse !== undefined && (
          <IconButton aria-label="후보 칸 접기" onClick={onCollapse} sx={{ width: 44, height: 44 }}>
            <PanelLeftCloseIcon aria-hidden="true" width={20} height={20} />
          </IconButton>
        )}
      </Box>
      <Box
        component="h2"
        sx={{ flex: 'none', m: 0, px: 2, pt: 2, pb: 1, fontSize: 14, fontWeight: 700 }}
      >
        {`후보 ${candidates.length}`}
      </Box>
      <Box
        sx={{
          ...(fill ? { flex: 1, minHeight: 0, overflow: 'auto' } : {}),
          borderTop: '1px solid var(--tm-border)',
        }}
      >
        {candidates.length === 0 ? (
          <Box sx={{ px: 2, py: 4, textAlign: 'center', color: 'var(--tm-text-muted)' }}>
            후보가 없어요
          </Box>
        ) : (
          <Box component="ul" aria-label="후보" sx={{ m: 0, p: 0 }}>
            {candidates.map((place) => (
              <CandidateRow
                key={place.id}
                place={place}
                region={regions.get(place.id) ?? ''}
                label={placeLabels(place, labelById)[0]}
                dayIndex={dayIndex}
                onAdd={() => add(place.id)}
                onOpen={() => openCard({ tripId: trip.id, placeId: place.id })}
              />
            ))}
          </Box>
        )}
      </Box>
      {/* Task 12·13에서 동작한다. */}
      <Box
        sx={{
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          p: 2,
          borderTop: '1px solid var(--tm-border)',
        }}
      >
        <Button variant="outlined" disabled sx={{ minHeight: 44, textTransform: 'none' }}>
          보관함에서 더하기
        </Button>
        <Button variant="outlined" disabled sx={{ minHeight: 44, textTransform: 'none' }}>
          링크·핀으로 새로 추가
        </Button>
        <Button variant="outlined" disabled sx={{ minHeight: 44, textTransform: 'none' }}>
          Day 자동 나누기
        </Button>
      </Box>
    </Box>
  );
}
