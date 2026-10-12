import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useAtomValue } from 'jotai';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { XIcon } from 'src/components/icons';
import {
  insertStop,
  moveStop,
  setLodging,
  setStopFixedTime,
  setStopStay,
  unscheduleStop,
} from 'src/domain/trips/ops';
import { tripDates, visibleStops } from 'src/domain/trips/query';
import type { Stop, Trip } from 'src/schema/trip';
import { shortDate } from 'src/sections/trips/trip-dates';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const INPUT_SX = {
  width: '100%',
  minHeight: 44,
  px: 1,
  border: '1px solid var(--tm-border)',
  borderRadius: 'var(--tm-radius-md)',
  bgcolor: 'var(--tm-bg-raised)',
  color: 'var(--tm-text-primary)',
  font: 'inherit',
  fontSize: 16,
  fontVariantNumeric: 'tabular-nums',
  '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: 1 },
} as const;

const BUTTON_SX = { minHeight: 44, textTransform: 'none' } as const;

/** 장소가 어느 Day의 몇 번째(보이는 Stop 기준)에 있는지. */
function findStop(
  lib: Parameters<typeof visibleStops>[0],
  trip: Trip,
  placeId: string,
): { dayIndex: number; index: number; stop: Stop } | null {
  for (let d = 0; d < trip.days.length; d++) {
    const stops = visibleStops(lib, trip.days[d]!);
    const index = stops.findIndex((s) => s.placeId === placeId);
    if (index >= 0) return { dayIndex: d, index, stop: stops[index]! };
  }
  return null;
}

/** 저장된 값이 바뀌면(저장 성공·다른 탭) 입력 중인 값을 그 값으로 맞추는 입력 상태. */
function useDraft(saved: string): [string, (value: string) => void] {
  const [draft, setDraft] = useState({ base: saved, value: saved });
  if (draft.base !== saved) {
    setDraft({ base: saved, value: saved }); // 렌더 중 상태 갱신
    return [saved, (value) => setDraft({ base: saved, value })];
  }
  return [draft.value, (value) => setDraft({ base: saved, value })];
}

/** Stop의 체류 시간(분)·고정 시각 입력. 체류 시간은 나갈 때나 Enter로 저장하고, 고정 시각은 바로 저장한다. */
function StopFields({
  stop,
  onStay,
  onFixedTime,
}: {
  stop: Stop;
  onStay(minutes: number | null): void;
  onFixedTime(value: string): void;
}) {
  const savedStay = stop.stayMin === null ? '' : String(stop.stayMin);
  const [stay, setStay] = useDraft(savedStay);
  const savedFixed = stop.fixedTime ?? '';
  const [fixed, setFixed] = useDraft(savedFixed);

  const commitStay = () => {
    const text = stay.trim();
    const minutes = text === '' ? null : Number(text);
    if (minutes !== null && !Number.isFinite(minutes)) {
      setStay(savedStay);
      return;
    }
    // 연산과 같은 범위(0–1440 정수)로 맞춰 보인다. 같은 값이 저장돼 있어도 입력란이 맞춘 값을 보이게 한다.
    const clamped = minutes === null ? null : Math.min(1440, Math.max(0, Math.round(minutes)));
    setStay(clamped === null ? '' : String(clamped));
    if (clamped !== stop.stayMin) onStay(clamped);
  };

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mt: 1.5 }}>
      <Box component="label" sx={{ fontSize: 12, color: 'var(--tm-text-secondary)' }}>
        체류(분)
        <Box
          component="input"
          type="number"
          inputMode="numeric"
          min={0}
          max={1440}
          step={1}
          placeholder="0"
          aria-label="체류 시간(분)"
          value={stay}
          onChange={(event) => setStay(event.target.value)}
          onBlur={commitStay}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') commitStay();
          }}
          sx={{ ...INPUT_SX, mt: 0.5 }}
        />
      </Box>
      <Box component="label" sx={{ fontSize: 12, color: 'var(--tm-text-secondary)' }}>
        고정 시각
        <Box
          component="input"
          type="time"
          aria-label="고정 시각"
          value={fixed}
          onChange={(event) => {
            const next = event.target.value;
            setFixed(next);
            // 비우면 고정을 풀고, 형식이 맞는 값만 저장한다.
            if ((next === '' || HHMM.test(next)) && next !== savedFixed) onFixedTime(next);
          }}
          onBlur={() => {
            if (fixed !== '' && !HHMM.test(fixed)) setFixed(savedFixed);
          }}
          sx={{ ...INPUT_SX, mt: 0.5 }}
        />
      </Box>
    </Box>
  );
}

type Props = {
  trip: Trip;
  /** 고른 Day. 후보의 `Day N에 넣기`와 `숙소로 정하기`의 대상이다. */
  dayIndex: number;
  placeId: string;
  onClose(): void;
  onDetail(placeId: string): void;
};

/**
 * 지도 위 카드(스펙 §2.3): 이름·분류·위치(`후보` / `Day 2 · 3번째`). 후보면 `Day N에 넣기`, Day의 장소면
 * 체류 시간·고정 시각·`다른 Day로`·`후보로 빼기`, 공통으로 `숙소로 정하기`(고른 Day)와 `상세`.
 * Esc나 카드 밖을 누르면 닫는다(메뉴가 열려 있을 때는 메뉴만 닫힌다). 장소가 바뀌면 부른 쪽이 `key`로 새로 만든다.
 */
export function MapCard({ trip, dayIndex, placeId, onClose, onDetail }: Props) {
  const library = useAtomValue(libraryAtom);
  const { run } = useLibraryAction();
  const cardRef = useRef<HTMLDivElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const menuOpen = useRef(false);
  useEffect(() => {
    menuOpen.current = menuAnchor !== null;
  }, [menuAnchor]);
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  });

  // 열릴 때 카드로 초점을 옮기고, Esc로 닫으면 연 자리로 돌려준다.
  useEffect(() => {
    const card = cardRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    card?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || menuOpen.current) return;
      latestClose.current();
      if (opener?.isConnected) opener.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (menuOpen.current) return;
      if (event.target instanceof Node && card?.contains(event.target)) return;
      latestClose.current();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  const place = library.places[placeId];
  if (place === undefined || place.deletedAt !== null) return null;
  const name = place.name.value;
  const found = findStop(library, trip, placeId);
  const isCandidate = found === null && trip.candidates.value.includes(placeId);
  const isLodging = trip.days.some((d) => d.lodging.value === placeId);
  const where = found
    ? `Day ${found.dayIndex + 1} · ${found.index + 1}번째`
    : isCandidate
      ? '후보'
      : isLodging
        ? '숙소'
        : trip.origin.value === placeId
          ? '출발지'
          : null;
  const dates = tripDates(trip);
  const tripId = trip.id;

  const addToDay = () =>
    void run((lib, ctx) => {
      // 끝 자리는 저장 직전의 최신본 기준으로 정한다.
      const end = lib.trips[tripId]?.days[dayIndex]?.stops.value.length ?? 0;
      return insertStop(lib, tripId, placeId, dayIndex, end, ctx);
    });
  const moveToDay = (target: number) => {
    setMenuAnchor(null);
    if (found === null) return;
    const stopId = found.stop.id;
    void run((lib, ctx) => {
      const end = lib.trips[tripId]?.days[target]?.stops.value.length ?? 0;
      return moveStop(lib, tripId, stopId, target, end, ctx);
    });
  };

  return (
    <Box
      ref={cardRef}
      role="dialog"
      aria-label={name}
      tabIndex={-1}
      sx={{
        p: 2,
        bgcolor: 'var(--tm-bg-surface)',
        color: 'var(--tm-text-primary)',
        borderRadius: 'var(--tm-radius-lg)',
        boxShadow: 'var(--tm-shadow-2)',
        '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: 2 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box
            component="h2"
            sx={{ m: 0, fontSize: 17, fontWeight: 800, overflowWrap: 'anywhere' }}
          >
            {name}
          </Box>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              columnGap: 1,
              mt: 0.25,
              fontSize: 13,
              color: 'var(--tm-text-secondary)',
            }}
          >
            {place.category.value !== null && <span>{place.category.value}</span>}
            {where !== null && (
              <Box component="span" sx={{ fontWeight: 700, color: 'var(--tm-text-primary)' }}>
                {where}
              </Box>
            )}
          </Box>
        </Box>
        <IconButton
          aria-label="카드 닫기"
          onClick={onClose}
          sx={{ flex: 'none', width: 44, height: 44, mt: -1, mr: -1 }}
        >
          <XIcon aria-hidden="true" width={18} height={18} />
        </IconButton>
      </Box>

      {found !== null && (
        <StopFields
          stop={found.stop}
          onStay={(minutes) =>
            void run((lib, ctx) => setStopStay(lib, tripId, found.stop.id, minutes, ctx))
          }
          onFixedTime={(value) =>
            void run((lib, ctx) => setStopFixedTime(lib, tripId, found.stop.id, value, ctx))
          }
        />
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
        {isCandidate && (
          <Button variant="contained" onClick={addToDay} sx={BUTTON_SX}>
            {`Day ${dayIndex + 1}에 넣기`}
          </Button>
        )}
        {found !== null && (
          <>
            <Button
              variant="outlined"
              aria-haspopup="menu"
              aria-expanded={menuAnchor !== null}
              disabled={trip.days.length < 2}
              onClick={(event) => setMenuAnchor(event.currentTarget)}
              sx={BUTTON_SX}
            >
              다른 Day로
            </Button>
            <Button
              variant="outlined"
              onClick={() =>
                void run((lib, ctx) => unscheduleStop(lib, tripId, found.stop.id, ctx))
              }
              sx={BUTTON_SX}
            >
              후보로 빼기
            </Button>
          </>
        )}
        <Button
          variant="outlined"
          disabled={trip.days[dayIndex]?.lodging.value === placeId}
          onClick={() =>
            void run((lib, ctx) => setLodging(lib, tripId, dayIndex, placeId, false, ctx))
          }
          sx={BUTTON_SX}
        >
          숙소로 정하기
        </Button>
        <Button variant="text" onClick={() => onDetail(placeId)} sx={BUTTON_SX}>
          상세
        </Button>
      </Box>

      <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}>
        {trip.days.map((_, d) =>
          found === null || d === found.dayIndex ? null : (
            <MenuItem key={d} onClick={() => moveToDay(d)} sx={{ minHeight: 44 }}>
              {`Day ${d + 1} ${dates[d] === undefined ? '' : shortDate(dates[d])}`}
            </MenuItem>
          ),
        )}
      </Menu>
    </Box>
  );
}
