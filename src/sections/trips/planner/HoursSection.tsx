import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { visuallyHidden } from '@mui/utils';
import { useState } from 'react';
import {
  checkDate,
  checkVisit,
  dayRuleFor,
  ruleExtras,
  ruleText,
  uncountedRules,
  visitOf,
  type VisitCheck,
} from 'src/domain/trips/hours';
import { tripDates } from 'src/domain/trips/query';
import type { Place } from 'src/schema/library';
import type { Stop, Trip } from 'src/schema/trip';
import type { PlaceHours } from 'src/server/hours';
import { HoursLookupError } from 'src/services/errors';
import { hoursCheckedLabel, objectParticle } from 'src/sections/trips/planner/format';
import { HoursNotice, noticeFor } from 'src/sections/trips/planner/HoursNotice';
import type { DayPlan } from 'src/sections/trips/planner/use-day-plan';
import { usePlaceHours } from 'src/sections/trips/planner/use-place-hours';
import { shortDate } from 'src/sections/trips/trip-dates';

const LINE_SX = { fontSize: 13, overflowWrap: 'anywhere' } as const;
const SUB_SX = {
  fontSize: 12,
  color: 'var(--tm-text-secondary)',
  overflowWrap: 'anywhere',
} as const;
const NEEDS_CHECK = '영업시간 확인 필요 — ';

type Props = {
  trip: Trip;
  /** 고른 Day. 후보의 규칙 줄은 이 Day 날짜로 본다. */
  dayIndex: number;
  place: Place;
  /** 고른 Day의 시간표. 고른 Day의 장소는 이 시각으로 판정한다. */
  plan: DayPlan;
  /** 그 장소가 있는 Day·순서. 후보면 null. */
  found: { dayIndex: number; index: number; stop: Stop } | null;
};

/** 확인 필요 한 줄(12px 보조 글자). */
const needsCheck = (reason: string) => (
  <HoursNotice notice={{ text: `${NEEDS_CHECK}${reason}`, tone: 'muted' }} />
);

/** 받은 정보의 본문: 그날 규칙 줄·덧붙임·경고 칩·다른 Day 안내·계산하지 않는 규칙·네이버 원문. */
function KnownHours({
  hours,
  date,
  dayLabel,
  check,
  otherDay,
}: {
  hours: PlaceHours;
  date: string;
  dayLabel: string;
  check(hours: PlaceHours): VisitCheck;
  /** 고르지 않은 Day의 장소면 그 Day 번호(1부터). */
  otherDay: number | null;
}) {
  if (hours.days.length === 0) return needsCheck('네이버에 영업시간이 없어요');
  const rule = dayRuleFor(hours, date);
  const extras = rule.kind === 'open' ? ruleExtras(rule.day) : null;
  // 그 요일 규칙이 없으면 규칙 줄이 `확인 필요`라 따로 보이지 않고 경고 칩만 보인다.
  const notice = noticeFor({ kind: 'known', hours, pending: false, error: null }, check);
  const uncounted = uncountedRules(hours);
  const holiday = hours.days.some((d) => d.day.includes('공휴일'));
  const otherLabel = otherDay === null ? null : `Day ${otherDay}`;
  return (
    <>
      <Box sx={LINE_SX}>{`${dayLabel} · ${ruleText(rule)}`}</Box>
      {extras !== null && <Box sx={SUB_SX}>{extras}</Box>}
      {notice !== null && notice.tone === 'warn' && <HoursNotice notice={notice} />}
      {otherLabel !== null && (
        <Box sx={SUB_SX}>{`시각은 ${otherLabel}${objectParticle(otherLabel)} 고르면 확인해요`}</Box>
      )}
      {uncounted.map((line, i) => (
        <Box key={i} sx={SUB_SX}>
          {line}
        </Box>
      ))}
      {holiday && <Box sx={SUB_SX}>공휴일 영업시간은 계산에 넣지 않아요</Box>}
      {hours.note !== null && <Box sx={SUB_SX}>{`네이버 안내: ${hours.note}`}</Box>}
      {hours.irregularClosed.length > 0 && (
        <Box sx={SUB_SX}>{`다가오는 임시 휴무: ${hours.irregularClosed.join(', ')}`}</Box>
      )}
      {hours.regularClosed !== null && <Box sx={SUB_SX}>{`정기 휴무: ${hours.regularClosed}`}</Box>}
      {hours.otherSchedules.length > 0 && (
        <Box sx={SUB_SX}>{`다른 운영 시간도 있어요: ${hours.otherSchedules.join(', ')}`}</Box>
      )}
    </>
  );
}

/**
 * 지도 카드의 `영업시간` 칸(스펙 §2.2). Day의 장소면 그 장소가 있는 Day, 후보면 고른 Day의 규칙을 보인다.
 * 고른 Day의 장소는 시간표의 도착 시각으로, 다른 Day의 장소·후보는 날짜(휴무·임시 휴무)로만 판정한다.
 * 출발지·숙소로만 쓰인 장소에는 칸이 없다. 후보는 계획 화면이 묻지 않으므로 이 칸이 그 장소 하나를 묻는다.
 */
export function HoursSection({ trip, dayIndex, place, plan, found }: Props) {
  const isCandidate = found === null && trip.candidates.value.includes(place.id);
  const { view, refresh } = usePlaceHours(place, { request: isCandidate });
  // 이 장소에서 `다시 확인`을 누른 횟수. 같은 날 다시 받아 날짜 줄이 그대로여도 알리려고 쓴다.
  const [asked, setAsked] = useState<{ placeId: string; count: number } | null>(null);
  if (found === null && !isCandidate) return null;

  const ruleDay = found?.dayIndex ?? dayIndex;
  const date = tripDates(trip)[ruleDay] ?? '';
  const dayLabel = `Day ${ruleDay + 1} · ${date === '' ? '' : shortDate(date)}`;
  // 고른 Day의 장소만 시각을 안다. points는 출발점이 있으면 그것부터다.
  const point =
    found !== null && found.dayIndex === dayIndex
      ? plan.schedule.points[(plan.input.hasStart ? 1 : 0) + found.index]
      : undefined;
  const check = (hours: PlaceHours): VisitCheck =>
    point !== undefined && found !== null
      ? checkVisit(hours, date, visitOf(point, found.stop))
      : checkDate(hours, date);
  const otherDay = found !== null && found.dayIndex !== dayIndex ? found.dayIndex + 1 : null;

  const pending = view.kind !== 'unsupported' && view.pending;
  const status =
    view.kind === 'known'
      ? `${hoursCheckedLabel(view.hours.fetchedAt)}${view.error === null ? '' : ' · 새로 받지 못했어요'}`
      : null;
  // 누른 뒤 새로 받았으면 보이지 않는 `확인했어요`를 붙인다. 받는 동안 빠졌다가 누를 때마다 새로 생겨 알린다.
  const confirmed =
    asked !== null &&
    asked.placeId === place.id &&
    !pending &&
    view.kind === 'known' &&
    view.error === null;
  // 받는 동안은 포커스를 지닌 채 `aria-disabled`이고 누름을 무시한다(`disabled`면 포커스가 카드 밖으로 빠진다).
  const onRefresh = () => {
    if (pending) return;
    setAsked((prev) => ({
      placeId: place.id,
      count: prev?.placeId === place.id ? prev.count + 1 : 1,
    }));
    refresh();
  };

  return (
    <Box sx={{ mt: 1.5 }}>
      <Box component="h3" sx={{ m: 0, mb: 0.5, fontSize: 13, fontWeight: 700 }}>
        영업시간
      </Box>
      {view.kind === 'unsupported' && needsCheck('네이버 장소만 영업시간을 받아요')}
      {view.kind === 'failed' &&
        needsCheck(new HoursLookupError({ code: view.error, seq: 0, fresh: false }).userMessage)}
      {view.kind === 'known' && (
        <KnownHours
          hours={view.hours}
          date={date}
          dayLabel={dayLabel}
          check={check}
          otherDay={otherDay}
        />
      )}
      {view.kind !== 'unsupported' && (
        <Box
          sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, mt: 0.5 }}
        >
          <Box
            aria-live="polite"
            sx={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--tm-text-muted)' }}
          >
            {status}
            {confirmed && (
              <Box key={asked.count} component="span" sx={visuallyHidden}>
                {' · 확인했어요'}
              </Box>
            )}
          </Box>
          <Button
            size="small"
            aria-disabled={pending || undefined}
            onClick={onRefresh}
            sx={{
              minHeight: 44,
              textTransform: 'none',
              '&[aria-disabled="true"]': { opacity: 0.5 },
            }}
          >
            {pending ? '확인 중…' : '다시 확인'}
          </Button>
        </Box>
      )}
    </Box>
  );
}
