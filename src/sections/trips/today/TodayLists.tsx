import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import { useState, type ReactNode } from 'react';
import { visitedOnOf } from 'src/domain/library/visit';
import { formatClock, formatSlack } from 'src/domain/trips/schedule';
import { isLate, type TodayModel, type TodayStop } from 'src/sections/trips/today/use-today';
import { shortDate } from 'src/sections/trips/trip-dates';

type Props = {
  model: TodayModel;
  /** 남은 일정 행의 이름을 눌렀다(`index`는 `model.stops`의 자리). */
  onSelect(index: number): void;
  /** 체크 상자를 눌렀다. `next`가 참이면 체크(남은 일정), 거짓이면 풀기(다녀온 곳). `index`는 그 목록에서의 자리. */
  onCheck(item: TodayStop, next: boolean, index: number): void;
  /** 다녀옴을 저장 중인 장소 id. 그동안 그 상자는 포커스를 지닌 채 `aria-disabled`(누름은 저장 쪽이 무시). */
  pending: ReadonlySet<string>;
};

const H2_SX = { m: 0, fontSize: 16, fontWeight: 800 } as const;
const LIST_SX = { m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 1 };
const TIME_SX = { fontSize: 13, color: 'var(--tm-text-secondary)' } as const;

/**
 * 시각 줄(스펙 §5.1): `09:00 도착 예정 · 12:00 고정`. 늦음이면 `예상 10:30 · 계획 09:00`(어림이면 `예상 약 10:30`).
 * 고정 시각이 있고 예상이 그보다 늦으면 끝에 `늦음 1시간 20분`(굵게, `error.main`). 그 행은 전체가 늦지 않아도
 * `예상 · 계획`을 보인다(`09:20 도착 예정 · 09:21 고정 · 늦음 2분`처럼 글끼리 어긋나지 않게).
 */
function TimeLine({ item, model }: { item: TodayStop; model: TodayModel }) {
  const { projected } = item;
  const planned = formatClock(item.planned.arriveMin);
  // 예상의 여유(`slackMin`, 정수 분)가 음수면 고정 시각에 늦는다.
  const slack = projected?.slackMin ?? null;
  const lateForFixed = slack !== null && slack < 0;
  const parts =
    projected !== null && (isLate(model) || lateForFixed)
      ? [
          `예상 ${model.approximate ? '약 ' : ''}${formatClock(projected.arriveMin)}`,
          `계획 ${planned}`,
        ]
      : [`${planned} 도착 예정`];
  if (item.stop.fixedTime !== null) parts.push(`${item.stop.fixedTime} 고정`);
  return (
    <Box sx={TIME_SX}>
      {parts.join(' · ')}
      {lateForFixed && (
        <>
          {' · '}
          <Box component="span" sx={{ fontWeight: 700, color: 'error.main' }}>
            {formatSlack(slack)}
          </Box>
        </>
      )}
    </Box>
  );
}

/**
 * 다녀옴 체크 상자(44×44, 이름 `‘<이름>’ 다녀옴`). 저장된 값만 보인다(낙관 표시 없음). 저장 중에도 `disabled`로
 * 끄지 않는다 — 끄면 포커스가 `body`로 떨어진다. `aria-disabled`로 알리고 누름은 `useVisitToggle`이 무시한다.
 */
function VisitCheckbox({
  item,
  list,
  pending,
  onChange,
}: {
  item: TodayStop;
  list: 'remaining' | 'visited';
  pending: boolean;
  onChange(next: boolean): void;
}) {
  return (
    <Checkbox
      data-today-check={list}
      checked={item.visited}
      onChange={(event) => onChange(event.target.checked)}
      slotProps={{
        input: {
          'aria-label': `‘${item.place.name.value}’ 다녀옴`,
          'aria-disabled': pending || undefined,
        },
      }}
      sx={{ flex: 'none', width: 44, height: 44, opacity: pending ? 0.5 : 1 }}
    />
  );
}

function RemainingRow({
  item,
  model,
  current,
  onSelect,
  check,
}: {
  item: TodayStop;
  model: TodayModel;
  current: boolean;
  onSelect(): void;
  /** 체크 상자. 기간 밖이면 없다. */
  check: ReactNode;
}) {
  return (
    <Box
      component="li"
      aria-current={current ? 'step' : undefined}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1,
        borderRadius: 'var(--tm-radius-md)',
        border: current ? '2px solid var(--tm-accent-main)' : '1px solid var(--tm-border)',
        bgcolor: 'var(--tm-bg-surface)',
      }}
    >
      {check}
      <Box sx={{ flex: 1, minWidth: 0, py: 0.5 }}>
        <ButtonBase
          onClick={onSelect}
          sx={{
            display: 'block',
            width: '100%',
            minHeight: 44,
            textAlign: 'left',
            font: 'inherit',
            fontSize: 15,
            fontWeight: 700,
            borderRadius: 'var(--tm-radius-sm)',
          }}
        >
          {`${item.number}. ${item.place.name.value}`}
        </ButtonBase>
        <TimeLine item={item} model={model} />
      </Box>
      {item.skipped && (
        <Box component="span" sx={{ flex: 'none', fontSize: 12, color: 'var(--tm-text-muted)' }}>
          지나침
        </Box>
      )}
    </Box>
  );
}

/**
 * 남은 일정과 다녀온 곳(스펙 §5.1). 남은 일정은 미체크 Stop을 순서대로 보이고, 다음 장소 행은 강조 테두리와
 * `aria-current="step"`, 건너뛴 곳은 `지나침` 꼬리표다. 다녀온 곳은 접힌 채 시작하고 0곳이면 그리지 않는다.
 * 기간 안이면 행마다 다녀옴 체크 상자를 둔다(남은 일정은 체크, 다녀온 곳은 풀기, 스펙 §4.4).
 */
export function TodayLists({ model, onSelect, onCheck, pending }: Props) {
  const [visitedOpen, setVisitedOpen] = useState(false);
  const check = (item: TodayStop, list: 'remaining' | 'visited', index: number) =>
    model.canCheck ? (
      <VisitCheckbox
        item={item}
        list={list}
        pending={pending.has(item.place.id)}
        onChange={(next) => onCheck(item, next, index)}
      />
    ) : null;
  const remaining = model.stops.flatMap((item, index) => (item.visited ? [] : [{ item, index }]));
  const visited = model.stops.filter((item) => item.visited);
  const nextIndex = model.next?.kind === 'stop' ? model.next.index : null;

  return (
    <>
      {remaining.length > 0 && (
        <Box component="section" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box component="h2" sx={H2_SX}>{`남은 일정 ${remaining.length}곳`}</Box>
          <Box component="ol" aria-label="남은 일정" sx={LIST_SX}>
            {remaining.map(({ item, index }, at) => (
              <RemainingRow
                key={item.stop.id}
                item={item}
                model={model}
                current={index === nextIndex}
                onSelect={() => onSelect(index)}
                check={check(item, 'remaining', at)}
              />
            ))}
          </Box>
        </Box>
      )}
      {visited.length > 0 && (
        <Box component="section" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box component="h2" sx={H2_SX}>
            <Button
              data-today-fold=""
              aria-expanded={visitedOpen}
              onClick={() => setVisitedOpen((open) => !open)}
              sx={{ minHeight: 44, px: 0, font: 'inherit', fontWeight: 800 }}
            >
              {`다녀온 곳 ${visited.length}곳`}
            </Button>
          </Box>
          {visitedOpen && (
            <Box component="ul" aria-label="다녀온 곳" sx={LIST_SX}>
              {visited.map((item, at) => {
                const on = visitedOnOf(item.place);
                return (
                  <Box
                    component="li"
                    key={item.stop.id}
                    sx={{
                      minHeight: 44,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      px: 1,
                      color: 'var(--tm-text-secondary)',
                    }}
                  >
                    {check(item, 'visited', at)}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ fontSize: 15, fontWeight: 700 }}>{item.place.name.value}</Box>
                      {(on !== null || item.visitedBy !== null) && (
                        <Box sx={TIME_SX}>
                          {['다녀옴', on !== null ? shortDate(on) : null, item.visitedBy]
                            .filter(Boolean)
                            .join(' · ')}
                        </Box>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      )}
    </>
  );
}
