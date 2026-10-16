import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import type { ReactNode } from 'react';
import type { Trip } from 'src/schema/trip';
import { objectParticle } from 'src/sections/trips/planner/format';
import type { TodayModel } from 'src/sections/trips/today/use-today';
import { shortDate } from 'src/sections/trips/trip-dates';

/** 띠 하나. 읽기 프로그램이 알 수 있게 `role="status"`다. */
export function NoticeBand({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <Box
      role="status"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 1,
        px: 1.5,
        py: 1,
        borderRadius: 'var(--tm-radius-md)',
        bgcolor: 'var(--tm-bg-raised)',
        fontSize: 14,
        color: 'var(--tm-text-secondary)',
      }}
    >
      <Box component="span" sx={{ flex: '1 1 12em', py: 0.5 }}>
        {children}
      </Box>
      {action}
    </Box>
  );
}

/** 기간 밖 띠의 문구(스펙 §4.2). 기간 안이면 null. */
function periodNotice(model: TodayModel, trip: Trip): string | null {
  const { status } = model;
  if (status.kind === 'before') {
    const when = status.daysUntil <= 1 ? '내일' : `${status.daysUntil}일 뒤`;
    return `여행은 ${when}(${shortDate(trip.startDate.value)}) 시작해요. Day 1을 미리 보여 드려요`;
  }
  if (status.kind === 'after') {
    return `여행이 끝났어요(${shortDate(trip.endDate.value)}). 마지막 Day를 보여 드려요`;
  }
  return null;
}

type Props = {
  model: TodayModel;
  trip: Trip;
  /** `오늘로`: 오늘 Day로 돌아간다. */
  onToday(): void;
  /** 뒤에 이어 쌓을 띠(오프라인·위치 등). */
  children?: ReactNode;
};

/** 스크롤 칸 맨 위의 띠들(스펙 §5.1): 기간 밖 / 다른 Day / 그 밖의 띠(`children`). 하나씩 쌓인다. */
export function TodayNotices({ model, trip, onToday, children }: Props) {
  const period = periodNotice(model, trip);
  const otherDay = model.todayIndex !== null && !model.isToday;
  const dayName = `Day ${model.dayIndex + 1}`;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, '&:empty': { display: 'none' } }}>
      {period !== null && <NoticeBand>{period}</NoticeBand>}
      {otherDay && (
        <NoticeBand
          action={
            <Button onClick={onToday} sx={{ minHeight: 44, fontWeight: 700 }}>
              오늘로
            </Button>
          }
        >
          {`오늘이 아닌 ${dayName}${objectParticle(dayName)} 보고 있어요`}
        </NoticeBand>
      )}
      {children}
    </Box>
  );
}
