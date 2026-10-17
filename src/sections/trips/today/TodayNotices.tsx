import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import type { ReactNode } from 'react';
import type { Trip } from 'src/schema/trip';
import { GeolocationError } from 'src/services/errors';
import { objectParticle } from 'src/sections/trips/planner/format';
import type { LocationState } from 'src/sections/trips/today/use-my-location';
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

/** 기간 밖 띠의 문구(스펙 §4.2). 시작 전이면 지금 보는 Day를 미리 보인다고 말한다. 기간 안이면 null. */
function periodNotice(model: TodayModel, trip: Trip): string | null {
  const { status } = model;
  if (status.kind === 'before') {
    const when = status.daysUntil <= 1 ? '내일' : `${status.daysUntil}일 뒤`;
    const dayName = `Day ${model.dayIndex + 1}`;
    return `여행은 ${when}(${shortDate(trip.startDate.value)}) 시작해요. ${dayName}${objectParticle(dayName)} 미리 보여 드려요`;
  }
  if (status.kind === 'after') {
    return `여행이 끝났어요(${shortDate(trip.endDate.value)}). 마지막 Day를 보여 드려요`;
  }
  return null;
}

const LOCATION_OFF = '내 위치를 켜면 다음 장소까지 거리와 도착을 알려 드려요';

/**
 * 위치 띠(스펙 §5.5). 아직 안 켰으면 `내 위치 켜기`, 오류면 F4의 `GeolocationError.userMessage` 그대로(못 찾음·시간
 * 초과는 `다시 시도`). 받는 중·받음·미지원이면 띠가 없다.
 */
function LocationNotice({ location, onLocate }: { location: LocationState; onLocate(): void }) {
  const { status } = location;
  if (status === 'watching' || status === 'unsupported') return null;
  const button = (label: string) => (
    <Button onClick={onLocate} sx={{ minHeight: 44, fontWeight: 700 }}>
      {label}
    </Button>
  );
  if (status === 'off') {
    return <NoticeBand action={button('내 위치 켜기')}>{LOCATION_OFF}</NoticeBand>;
  }
  return (
    <NoticeBand action={status === 'denied' ? undefined : button('다시 시도')}>
      {new GeolocationError({ reason: status }).userMessage}
    </NoticeBand>
  );
}

type Props = {
  model: TodayModel;
  trip: Trip;
  /** `오늘로`: 오늘 Day로 돌아간다. */
  onToday(): void;
  /** 내 위치 상태(위치 띠). */
  location: LocationState;
  /** `내 위치 켜기`·`다시 시도`. */
  onLocate(): void;
  /** 위치 띠 앞에 이어 쌓을 띠(오프라인 등). */
  children?: ReactNode;
};

/**
 * 스크롤 칸 맨 위의 띠들(스펙 §5.1): 기간 밖 / 다른 Day / 그 밖의 띠(`children`) / 위치. 하나씩 쌓인다.
 */
export function TodayNotices({ model, trip, onToday, location, onLocate, children }: Props) {
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
      <LocationNotice location={location} onLocate={onLocate} />
    </Box>
  );
}
