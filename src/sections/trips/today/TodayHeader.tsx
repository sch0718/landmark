import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useSetAtom } from 'jotai';
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CheckIcon, ChevronLeftIcon, EllipsisIcon } from 'src/components/icons';
import { TruncatedText } from 'src/components/TruncatedText';
import { tripDates } from 'src/domain/trips/query';
import { paths } from 'src/routes/paths';
import type { Trip } from 'src/schema/trip';
import type { TodayModel } from 'src/sections/trips/today/use-today';
import { shortDate } from 'src/sections/trips/trip-dates';
import { selectPlannerDayAtom } from 'src/stores/trip-planner';

const ITEM_SX = { minHeight: 44 } as const;
export const TO_PLANNER_LABEL = '계획 화면으로';

/** `Day 2 · 10.25(일)`. */
export function dayLabel(trip: Trip, dayIndex: number): string {
  const date = tripDates(trip)[dayIndex];
  return `Day ${dayIndex + 1}${date === undefined ? '' : ` · ${shortDate(date)}`}`;
}

type Props = {
  trip: Trip;
  model: TodayModel;
  onPickDay(dayIndex: number): void;
  /** 메뉴의 Day 목록 뒤(구분선 다음), `계획 화면으로` 앞에 둘 항목들. */
  extraMenu?: ReactNode;
  /** 부제 아래에 붙이는 작은 표시(예: 화면 켜 둠). */
  badge?: ReactNode;
};

/**
 * 당일 모드 머리(스펙 §5.1): `‹ 계획`(계획 화면으로) · `h1` `오늘 일정`과 부제 · `⋯` 메뉴(Day 고르기·계획 화면으로).
 * 계획 화면으로 갈 때 계획 화면의 고른 Day를 지금 보는 Day로 맞춘다(스펙 §3.3).
 */
export function TodayHeader({ trip, model, onPickDay, extraMenu, badge }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const selectPlannerDay = useSetAtom(selectPlannerDayAtom);
  const toPlanner = () => selectPlannerDay(trip.id, model.dayIndex);
  const close = () => setAnchor(null);

  return (
    <Box
      component="header"
      sx={{
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.5,
        py: 0.5,
        borderBottom: '1px solid var(--tm-border)',
        bgcolor: 'var(--tm-bg-surface)',
      }}
    >
      <Button
        component={Link}
        to={paths.trip(trip.id)}
        onClick={toPlanner}
        aria-label={TO_PLANNER_LABEL}
        startIcon={<ChevronLeftIcon aria-hidden="true" width={20} height={20} />}
        sx={{ flex: 'none', minHeight: 44, minWidth: 44, px: 1, fontWeight: 700 }}
      >
        계획
      </Button>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box component="h1" sx={{ m: 0, fontSize: 18, fontWeight: 800, lineHeight: 1.3 }}>
          오늘 일정
        </Box>
        <TruncatedText component="div" sx={{ fontSize: 13, color: 'var(--tm-text-secondary)' }}>
          {`${trip.title.value} · ${dayLabel(trip, model.dayIndex)}`}
        </TruncatedText>
        {badge}
      </Box>
      <IconButton
        aria-label="오늘 일정 메뉴"
        aria-haspopup="menu"
        aria-expanded={anchor !== null ? 'true' : undefined}
        aria-controls={anchor === null ? undefined : menuId}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ flex: 'none', width: 44, height: 44 }}
      >
        <EllipsisIcon aria-hidden="true" width={20} height={20} />
      </IconButton>
      <Menu id={menuId} anchorEl={anchor} open={anchor !== null} onClose={close}>
        {trip.days.map((_, d) => (
          <MenuItem
            key={d}
            role="menuitemradio"
            aria-checked={d === model.dayIndex}
            selected={d === model.dayIndex}
            sx={ITEM_SX}
            onClick={() => {
              onPickDay(d);
              close();
            }}
          >
            <Box component="span" sx={{ display: 'inline-flex', width: 20, mr: 1 }}>
              {d === model.dayIndex && <CheckIcon aria-hidden="true" width={18} height={18} />}
            </Box>
            {`${dayLabel(trip, d)}${d === model.todayIndex ? ' · 오늘' : ''}`}
          </MenuItem>
        ))}
        <Divider />
        {extraMenu}
        <MenuItem component={Link} to={paths.trip(trip.id)} onClick={toPlanner} sx={ITEM_SX}>
          {TO_PLANNER_LABEL}
        </MenuItem>
      </Menu>
    </Box>
  );
}
