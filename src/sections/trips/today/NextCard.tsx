import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useSetAtom } from 'jotai';
import { useId, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router';
import { formatDistanceM } from 'src/domain/nearby';
import { haversineM } from 'src/domain/trips/geo';
import { formatClock, formatSpan } from 'src/domain/trips/schedule';
import { paths } from 'src/routes/paths';
import type { Place } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';
import { useLayout } from 'src/sections/shell/use-layout';
import {
  directionsFrom,
  pointBefore,
  todayDirections,
  type DirectionsTarget,
} from 'src/sections/trips/today/today-directions';
import { isLate, type TodayModel, type TodayStop } from 'src/sections/trips/today/use-today';
import { selectPlannerDayAtom } from 'src/stores/trip-planner';

type Props = {
  model: TodayModel;
  trip: Trip;
  /** 남은 일정 행·지도 핀으로 고른 Stop의 자리. 없으면 다음 장소를 보인다. */
  selected: number | null;
  onShowNext(): void;
  /** 카드의 `다녀옴`을 눌렀다. */
  onCheck(target: TodayStop): void;
  onSetNext?: (item: TodayStop) => void;
  /** 다녀옴을 저장 중인 장소 id. 그동안 `다녀옴`은 포커스를 지닌 채 `aria-disabled`(누름은 저장 쪽이 무시). */
  pending: ReadonlySet<string>;
  /** 카드(`section`). `다음 장소 보기`·체크 뒤 포커스를 여기에 둔다. */
  cardRef: RefObject<HTMLElement | null>;
};

const HEAD_SX = { fontSize: 13, fontWeight: 700, color: 'var(--tm-text-secondary)' } as const;
const TITLE_SX = { m: 0, fontSize: 20, fontWeight: 800, lineHeight: 1.3 } as const;
const LINE_SX = { fontSize: 14, color: 'var(--tm-text-secondary)' } as const;
const ACTIONS_SX = { display: 'flex', flexWrap: 'wrap', gap: 1, mt: 0.5 } as const;
const LATE_SX = { ...LINE_SX, fontWeight: 700, color: 'error.main' } as const;
const NO_ORIGIN = '출발 지점을 몰라요. 내 위치를 켜 주세요';

/** 줄 1: `계획 도착 09:00 · 체류 1시간 · 12:00 고정`(스펙 §5.3). */
function plannedLine(target: TodayStop): string {
  const parts = [`계획 도착 ${formatClock(target.planned.arriveMin)}`];
  const { stayMin, fixedTime } = target.stop;
  if (stayMin !== null && stayMin > 0) parts.push(`체류 ${formatSpan(stayMin)}`);
  if (fixedTime !== null) parts.push(`${fixedTime} 고정`);
  return parts.join(' · ');
}

/**
 * 줄 2(스펙 §5.3): 늦어짐을 계산할 때(§4.6)만. 늦으면 `지금 출발하면 10:50 도착 · 1시간 30분 늦음`(앞 지점이
 * 없으면 `계획보다 1시간 30분 늦음`), 아니면 `계획대로`. 다음 장소로 가는 구간이 어림값이면 시각 앞에 `약 `.
 */
function DelayLine({
  model,
  target,
  index,
}: {
  model: TodayModel;
  target: TodayStop;
  index: number;
}) {
  if (model.delayMin === null || target.projected === null) return null;
  if (!isLate(model)) return <Box sx={LINE_SX}>계획대로</Box>;
  const late = `${formatSpan(model.delayMin)} 늦음`;
  // 지금 여기이거나 앞 지점이 없으면 예상은 "계획 도착부터"라 지금 출발 시각을 말하지 않는다(스펙 §4.6).
  const text =
    model.here || pointBefore(model, index) === null
      ? `계획보다 ${late}`
      : `지금 출발하면 ${model.approximate ? '약 ' : ''}${formatClock(target.projected.arriveMin)} 도착 · ${late}`;
  return <Box sx={LATE_SX}>{text}</Box>;
}

/** 줄 3(스펙 §5.3): 쓸 수 있는 내 위치가 있으면 그 장소까지 `직선 <거리>`. */
function DistanceLine({ model, to }: { model: TodayModel; to: Place }) {
  const { fix } = model;
  if (fix === null) return null;
  const m = haversineM([fix.lng, fix.lat], [to.lng, to.lat]);
  return <Box sx={LINE_SX}>{`직선 ${formatDistanceM(m)}`}</Box>;
}

/**
 * 길찾기(스펙 §4.8). 쓸 수 있는 내 위치 → 앞 지점에서 `to`까지(`directionsFrom`). 좁은 화면은 네이버 지도 앱
 * 주소(같은 탭), 그 밖은 웹 주소(새 탭). 출발점을 모르면 끈 버튼(`action`)과 버튼 줄 아래에 둘 안내(`hint`).
 */
function directions(args: {
  model: TodayModel;
  to: Place;
  target: DirectionsTarget;
  platform: 'app' | 'web';
  label: string;
  /** 접근 이름. 없으면 `label`. */
  name?: string;
  variant: 'contained' | 'outlined';
  hintId: string;
}): { action: ReactNode; hint: ReactNode } {
  const { model, to, target, platform, label, name, variant, hintId } = args;
  const origin = directionsFrom(model, target, model.fix);
  if (origin === null) {
    return {
      action: (
        <Button
          disabled
          aria-label={name}
          aria-describedby={hintId}
          variant={variant}
          sx={{ minHeight: 44 }}
        >
          {label}
        </Button>
      ),
      hint: (
        <Box id={hintId} sx={LINE_SX}>
          {NO_ORIGIN}
        </Box>
      ),
    };
  }
  const url = todayDirections({ to, origin, platform });
  if (url === null) return { action: null, hint: null };
  return {
    action: (
      <Button
        component="a"
        href={url}
        // 웹 길찾기만 새 탭으로 연다. 앱 주소(nmap://)는 새 탭이면 빈 탭이 남는다(`LegRow`와 같다).
        {...(url.startsWith('https://') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        aria-label={name}
        variant={variant}
        sx={{ minHeight: 44 }}
      >
        {label}
      </Button>
    ),
    hint: null,
  };
}

/**
 * 다음 장소 카드(스펙 §5.3). 고른 장소가 있으면 그것을, 없으면 다음 장소(Stop 또는 모두 다녀온 뒤의 숙소)를 크게 보인다.
 * 그날 Stop이 없거나 모두 다녀왔고 숙소도 없으면 그 안내를 보인다. `다음 장소 보기` 뒤에는 포커스를 카드에 둔다.
 * 기간 안이면 Stop 카드에 `다녀옴`(스펙 §4.4)을 둔다. 숙소는 체크 대상이 아니다. 오늘 Day의 다음 장소면 줄 2에
 * 늦어짐(§4.6)을, 카드가 보는 곳(Stop·숙소)에는 `길찾기`(§4.8)를 둔다. 그날 Stop이 없으면 숙소로 길찾기 하나.
 */
export function NextCard({
  model,
  trip,
  selected,
  onShowNext,
  onCheck,
  onSetNext,
  pending,
  cardRef,
}: Props) {
  const selectPlannerDay = useSetAtom(selectPlannerDayAtom);
  const platform = useLayout() === 'compact' ? 'app' : 'web';
  const hintId = useId();
  const targetIndex =
    selected !== null ? selected : model.next?.kind === 'stop' ? model.next.index : null;
  const target = targetIndex === null ? undefined : model.stops[targetIndex];

  let body: ReactNode;
  if (model.stops.length === 0) {
    // 숙소만 있는 Day는 `마지막 · 숙소` 카드 대신 `숙소로 길찾기` 하나(스펙 §5.3).
    const lodging =
      model.end === null
        ? null
        : directions({
            model,
            to: model.end,
            target: 'end',
            platform,
            label: '숙소로 길찾기',
            variant: 'outlined',
            hintId,
          });
    body = (
      <>
        <Box component="h2" sx={TITLE_SX}>
          이 Day에는 일정이 없어요
        </Box>
        <Box sx={ACTIONS_SX}>
          <Button
            component={Link}
            to={paths.trip(trip.id)}
            onClick={() => selectPlannerDay(trip.id, model.dayIndex)}
            variant="outlined"
            sx={{ minHeight: 44 }}
          >
            계획 화면에서 장소 넣기
          </Button>
        </Box>
        {lodging != null && lodging.action !== null && <Box sx={ACTIONS_SX}>{lodging.action}</Box>}
        {lodging?.hint}
      </>
    );
  } else if (target !== undefined && targetIndex !== null) {
    // 지금 여기는 다음 장소의 것이다. 고른 장소를 보는 동안에는 쓰지 않는다.
    const here = selected === null && model.here;
    const head = selected !== null ? '고른 장소' : here ? '지금 여기' : '다음';
    const name = target.place.name.value;
    // 기간 밖에는 체크하지 않는다(스펙 §4.2). 이미 다녀온 곳(지도 핀으로 고름)은 다녀온 곳 목록에서 푼다.
    const canCheck = model.canCheck && !target.visited;
    // 지금 여기면 `다녀옴`이 주 버튼, `길찾기`는 보조. `다녀옴`이 없으면 `길찾기`가 그대로 주 버튼이다.
    const checkFirst = here && canCheck;
    const route = directions({
      model,
      to: target.place,
      target: targetIndex,
      platform,
      label: '길찾기',
      name: `${name}까지 길찾기`,
      variant: checkFirst ? 'outlined' : 'contained',
      hintId,
    });
    body = (
      <>
        <Box
          sx={HEAD_SX}
        >{`${head} · ${target.number}번째${selected === null && model.nextBy ? ` · ‘${model.nextBy}’에서 정함` : ''}`}</Box>
        <Box component="h2" sx={TITLE_SX}>
          {name}
        </Box>
        <Box sx={LINE_SX}>{plannedLine(target)}</Box>
        {/* 줄 2는 다음 장소의 늦어짐이다. 고른 장소에는 보이지 않는다. */}
        {selected === null && <DelayLine model={model} target={target} index={targetIndex} />}
        <DistanceLine model={model} to={target.place} />
        <Box sx={ACTIONS_SX}>
          {route.action}
          {canCheck && (
            <Button
              aria-label={`‘${name}’ 다녀옴으로 표시`}
              variant={checkFirst ? 'contained' : 'outlined'}
              aria-disabled={pending.has(target.place.id) || undefined}
              onClick={() => onCheck(target)}
              sx={{ minHeight: 44, '&[aria-disabled="true"]': { opacity: 0.5 } }}
            >
              다녀옴
            </Button>
          )}
          {selected !== null && model.shared && model.isToday && !target.visited && onSetNext && (
            <Button onClick={() => onSetNext(target)} sx={{ minHeight: 44 }}>
              다음 장소로 정하기
            </Button>
          )}
          {selected !== null && (
            <Button
              onClick={() => {
                onShowNext();
                cardRef.current?.focus();
              }}
              sx={{ minHeight: 44 }}
            >
              다음 장소 보기
            </Button>
          )}
        </Box>
        {route.hint}
      </>
    );
  } else if (model.next?.kind === 'end') {
    const arrive = model.plan.schedule.points.at(-1)?.arriveMin ?? 0;
    const lodgingName = model.next.place.name.value;
    const route = directions({
      model,
      to: model.next.place,
      target: 'end',
      platform,
      label: '길찾기',
      name: `${lodgingName}까지 길찾기`,
      variant: 'contained',
      hintId,
    });
    body = (
      <>
        <Box sx={HEAD_SX}>마지막 · 숙소</Box>
        <Box component="h2" sx={TITLE_SX}>
          {lodgingName}
        </Box>
        <Box sx={LINE_SX}>{`계획 도착 ${formatClock(arrive)}`}</Box>
        <DistanceLine model={model} to={model.next.place} />
        {route.action !== null && <Box sx={ACTIONS_SX}>{route.action}</Box>}
        {route.hint}
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
