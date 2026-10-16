import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useSetAtom } from 'jotai';
import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { formatClock, formatSpan } from 'src/domain/trips/schedule';
import { paths } from 'src/routes/paths';
import type { Trip } from 'src/schema/trip';
import type { TodayModel, TodayStop } from 'src/sections/trips/today/use-today';
import { selectedDayAtom } from 'src/stores/trip-planner';

type Props = {
  model: TodayModel;
  trip: Trip;
  /** 남은 일정 행·지도 핀으로 고른 Stop의 자리. 없으면 다음 장소를 보인다. */
  selected: number | null;
  onShowNext(): void;
};

const HEAD_SX = { fontSize: 13, fontWeight: 700, color: 'var(--tm-text-secondary)' } as const;
const TITLE_SX = { m: 0, fontSize: 20, fontWeight: 800, lineHeight: 1.3 } as const;
const LINE_SX = { fontSize: 14, color: 'var(--tm-text-secondary)' } as const;
const ACTIONS_SX = { display: 'flex', flexWrap: 'wrap', gap: 1, mt: 0.5 } as const;

/** 줄 1: `계획 도착 09:00 · 체류 1시간 · 12:00 고정`(스펙 §5.3). */
function plannedLine(target: TodayStop): string {
  const parts = [`계획 도착 ${formatClock(target.planned.arriveMin)}`];
  const { stayMin, fixedTime } = target.stop;
  if (stayMin !== null && stayMin > 0) parts.push(`체류 ${formatSpan(stayMin)}`);
  if (fixedTime !== null) parts.push(`${fixedTime} 고정`);
  return parts.join(' · ');
}

/**
 * 다음 장소 카드(스펙 §5.3). 고른 장소가 있으면 그것을, 없으면 다음 장소(Stop 또는 모두 다녀온 뒤의 숙소)를 크게 보인다.
 * 그날 Stop이 없거나 모두 다녀왔고 숙소도 없으면 그 안내를 보인다. `다음 장소 보기` 뒤에는 포커스를 카드에 둔다.
 */
export function NextCard({ model, trip, selected, onShowNext }: Props) {
  const cardRef = useRef<HTMLElement>(null);
  const setSelectedDay = useSetAtom(selectedDayAtom);
  const target =
    selected !== null
      ? model.stops[selected]
      : model.next?.kind === 'stop'
        ? model.stops[model.next.index]
        : undefined;

  let body: ReactNode;
  if (model.stops.length === 0) {
    body = (
      <>
        <Box component="h2" sx={TITLE_SX}>
          이 Day에는 일정이 없어요
        </Box>
        <Box sx={ACTIONS_SX}>
          <Button
            component={Link}
            to={paths.trip(trip.id)}
            onClick={() => setSelectedDay((prev) => ({ ...prev, [trip.id]: model.dayIndex }))}
            variant="outlined"
            sx={{ minHeight: 44 }}
          >
            계획 화면에서 장소 넣기
          </Button>
        </Box>
      </>
    );
  } else if (target !== undefined) {
    const head = selected !== null ? '고른 장소' : model.here ? '지금 여기' : '다음';
    body = (
      <>
        <Box sx={HEAD_SX}>{`${head} · ${target.number}번째`}</Box>
        <Box component="h2" sx={TITLE_SX}>
          {target.place.name.value}
        </Box>
        <Box sx={LINE_SX}>{plannedLine(target)}</Box>
        {selected !== null && (
          <Box sx={ACTIONS_SX}>
            <Button
              onClick={() => {
                onShowNext();
                cardRef.current?.focus();
              }}
              sx={{ minHeight: 44 }}
            >
              다음 장소 보기
            </Button>
          </Box>
        )}
      </>
    );
  } else if (model.next?.kind === 'end') {
    const arrive = model.plan.schedule.points.at(-1)?.arriveMin ?? 0;
    body = (
      <>
        <Box sx={HEAD_SX}>마지막 · 숙소</Box>
        <Box component="h2" sx={TITLE_SX}>
          {model.next.place.name.value}
        </Box>
        <Box sx={LINE_SX}>{`계획 도착 ${formatClock(arrive)}`}</Box>
      </>
    );
  } else {
    body = (
      <Box component="h2" sx={TITLE_SX}>
        오늘 일정을 모두 다녀왔어요
      </Box>
    );
  }

  return (
    <Box
      ref={cardRef}
      component="section"
      aria-label="다음 장소"
      tabIndex={-1}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        p: 2,
        bgcolor: 'var(--tm-bg-surface)',
        borderRadius: 'var(--tm-radius-lg)',
        boxShadow: 'var(--tm-shadow-2)',
      }}
    >
      {body}
    </Box>
  );
}
