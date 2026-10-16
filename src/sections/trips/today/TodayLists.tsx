import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Button from '@mui/material/Button';
import { useState } from 'react';
import { visitedOnOf } from 'src/domain/library/visit';
import { formatClock } from 'src/domain/trips/schedule';
import type { TodayModel, TodayStop } from 'src/sections/trips/today/use-today';
import { shortDate } from 'src/sections/trips/trip-dates';

type Props = {
  model: TodayModel;
  /** 남은 일정 행의 이름을 눌렀다(`index`는 `model.stops`의 자리). */
  onSelect(index: number): void;
};

const H2_SX = { m: 0, fontSize: 16, fontWeight: 800 } as const;
const LIST_SX = { m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 1 };
const TIME_SX = { fontSize: 13, color: 'var(--tm-text-secondary)' } as const;

/** 시각 줄: `09:00 도착 예정 · 12:00 고정`(스펙 §5.1). */
function timeLine(item: TodayStop): string {
  const parts = [`${formatClock(item.planned.arriveMin)} 도착 예정`];
  if (item.stop.fixedTime !== null) parts.push(`${item.stop.fixedTime} 고정`);
  return parts.join(' · ');
}

function RemainingRow({
  item,
  current,
  onSelect,
}: {
  item: TodayStop;
  current: boolean;
  onSelect(): void;
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
        <Box sx={TIME_SX}>{timeLine(item)}</Box>
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
 */
export function TodayLists({ model, onSelect }: Props) {
  const [visitedOpen, setVisitedOpen] = useState(false);
  const remaining = model.stops.flatMap((item, index) => (item.visited ? [] : [{ item, index }]));
  const visited = model.stops.filter((item) => item.visited);
  const nextIndex = model.next?.kind === 'stop' ? model.next.index : null;

  return (
    <>
      {remaining.length > 0 && (
        <Box component="section" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box component="h2" sx={H2_SX}>{`남은 일정 ${remaining.length}곳`}</Box>
          <Box component="ol" aria-label="남은 일정" sx={LIST_SX}>
            {remaining.map(({ item, index }) => (
              <RemainingRow
                key={item.stop.id}
                item={item}
                current={index === nextIndex}
                onSelect={() => onSelect(index)}
              />
            ))}
          </Box>
        </Box>
      )}
      {visited.length > 0 && (
        <Box component="section" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box component="h2" sx={H2_SX}>
            <Button
              aria-expanded={visitedOpen}
              onClick={() => setVisitedOpen((open) => !open)}
              sx={{ minHeight: 44, px: 0, font: 'inherit', fontWeight: 800 }}
            >
              {`다녀온 곳 ${visited.length}곳`}
            </Button>
          </Box>
          {visitedOpen && (
            <Box component="ul" aria-label="다녀온 곳" sx={LIST_SX}>
              {visited.map((item) => {
                const on = visitedOnOf(item.place);
                return (
                  <Box
                    component="li"
                    key={item.stop.id}
                    sx={{
                      minHeight: 44,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      px: 1,
                      color: 'var(--tm-text-secondary)',
                    }}
                  >
                    <Box sx={{ fontSize: 15, fontWeight: 700 }}>{item.place.name.value}</Box>
                    {on !== null && <Box sx={TIME_SX}>{`다녀옴 · ${shortDate(on)}`}</Box>}
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
