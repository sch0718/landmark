import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import { useAtomValue } from 'jotai';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { fieldSx } from 'src/components/field-style';
import { XIcon } from 'src/components/icons';
import { setStopFixedTime, setStopStay } from 'src/domain/trips/ops';
import { visibleStops } from 'src/domain/trips/query';
import type { Stop, Trip } from 'src/schema/trip';
import { HoursSection } from 'src/sections/trips/planner/HoursSection';
import { OtherDayMenu } from 'src/sections/trips/planner/StopMenu';
import {
  insertAtEnd,
  insertedMessage,
  LODGING_SET_MESSAGE,
  lodgingOp,
  moveToEnd,
  movedMessage,
  unschedule,
  UNSCHEDULED_MESSAGE,
} from 'src/sections/trips/planner/stop-ops';
import type { DayPlan } from 'src/sections/trips/planner/use-day-plan';
import { useTripUndo } from 'src/sections/trips/planner/use-trip-undo';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const INPUT_SX = [fieldSx(), { mt: 0.5, fontVariantNumeric: 'tabular-nums' }];

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

/** 체류 시간 입력값 → 분(0–1440 정수, 연산과 같은 범위). 비우면 null(기본값), 숫자가 아니면 undefined. */
function parseStay(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const minutes = Number(trimmed);
  if (!Number.isFinite(minutes)) return undefined;
  return Math.min(1440, Math.max(0, Math.round(minutes)));
}

/**
 * Stop의 체류 시간(분)·고정 시각 입력. 체류 시간은 나갈 때나 Enter로 저장하고, 입력 중에 카드가 닫혀
 * 사라지면(카드 밖을 누름 — 블러가 오지 않는다) 그때 저장한다. 입력란에서 Esc를 누르면 입력을 버린다.
 * 고정 시각은 형식이 맞는 값이 되는 즉시 저장하므로 남는 입력이 없다.
 */
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

  // 사라질 때 저장하려고 최신 입력·저장값·저장 함수를 둔다.
  const live = useRef({ stay, stayMin: stop.stayMin, onStay });
  useEffect(() => {
    live.current = { stay, stayMin: stop.stayMin, onStay };
  });
  useEffect(
    () => () => {
      const { stay: text, stayMin, onStay: save } = live.current;
      const minutes = parseStay(text);
      if (minutes !== undefined && minutes !== stayMin) save(minutes);
    },
    [],
  );

  const commitStay = () => {
    // 렌더의 값이 아니라 최신 입력을 읽는다: Esc로 버린 직후 카드가 닫히며 초점이 옮겨 가면 블러가 먼저 온다.
    const minutes = parseStay(live.current.stay);
    if (minutes === undefined) {
      setStay(savedStay);
      return;
    }
    // 맞춘 값을 보인다. 같은 값이 저장돼 있어도 입력란이 맞춘 값을 보이게 한다.
    const text = minutes === null ? '' : String(minutes);
    setStay(text);
    live.current.stay = text; // 곧바로 카드가 닫혀도 두 번 저장하지 않게
    if (minutes !== stop.stayMin) onStay(minutes);
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
            else if (event.key === 'Escape') {
              // 입력을 버린다. 이어서 카드가 닫혀도(문서의 Esc) 저장하지 않는다.
              setStay(savedStay);
              live.current.stay = savedStay;
            }
          }}
          sx={INPUT_SX}
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
          sx={INPUT_SX}
        />
      </Box>
    </Box>
  );
}

type Props = {
  trip: Trip;
  /** 고른 Day. 후보의 `Day N에 넣기`와 `숙소로 정하기`의 대상이다. */
  dayIndex: number;
  /** 고른 Day의 시간표(계획 화면이 한 번 구한 것). `영업시간` 칸이 도착 시각으로 판정한다. */
  plan: DayPlan;
  placeId: string;
  onClose(): void;
  onDetail(placeId: string): void;
};

/**
 * 지도 위 카드(스펙 §2.3): 이름·분류·위치(`후보` / `Day 2 · 3번째`). 후보면 `Day N에 넣기`, Day의 장소면
 * 체류 시간·고정 시각·`다른 Day로`·`후보로 빼기`, 공통으로 `숙소로 정하기`(고른 Day)와 `상세`. Day의 장소·후보는
 * 입력과 버튼 사이에 `영업시간` 칸(F6 스펙 §2.2)을 둔다.
 * Esc나 카드 밖을 누르면 닫는다(메뉴가 열려 있을 때는 메뉴만 닫힌다). 장소가 바뀌면 부른 쪽이 `key`로 새로 만든다.
 */
export function MapCard({ trip, dayIndex, plan, placeId, onClose, onDetail }: Props) {
  const library = useAtomValue(libraryAtom);
  const { run } = useLibraryAction();
  // 넣기·옮기기·빼기·숙소로 정하기는 되돌리기 토스트를 띄운다.
  const { run: runUndoable } = useTripUndo(trip.id);
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
  const tripId = trip.id;

  const addToDay = () =>
    void runUndoable(insertAtEnd(tripId, placeId, dayIndex), insertedMessage(dayIndex));
  const moveToDay = (target: number) => {
    setMenuAnchor(null);
    if (found === null) return;
    void runUndoable(moveToEnd(tripId, found.stop.id, target), movedMessage(target));
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

      <HoursSection trip={trip} dayIndex={dayIndex} place={place} plan={plan} found={found} />

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
                void runUndoable(unschedule(tripId, found.stop.id), UNSCHEDULED_MESSAGE)
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
            void runUndoable(lodgingOp(tripId, dayIndex, placeId, false), LODGING_SET_MESSAGE)
          }
          sx={BUTTON_SX}
        >
          숙소로 정하기
        </Button>
        <Button variant="text" onClick={() => onDetail(placeId)} sx={BUTTON_SX}>
          상세
        </Button>
      </Box>

      {found !== null && (
        <OtherDayMenu
          trip={trip}
          exclude={found.dayIndex}
          anchorEl={menuAnchor}
          onPick={moveToDay}
          onClose={() => setMenuAnchor(null)}
        />
      )}
    </Box>
  );
}
