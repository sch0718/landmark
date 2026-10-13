import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useState } from 'react';
import { EllipsisIcon } from 'src/components/icons';
import { tripDates } from 'src/domain/trips/query';
import type { Trip } from 'src/schema/trip';
import {
  dropCandidate,
  insertAtEnd,
  insertedMessage,
  moveOnto,
  moveToEnd,
  movedMessage,
  REMOVED_MESSAGE,
  unschedule,
  UNSCHEDULED_MESSAGE,
} from 'src/sections/trips/planner/stop-ops';
import { useTripUndo, type TripOp } from 'src/sections/trips/planner/use-trip-undo';
import { shortDate } from 'src/sections/trips/trip-dates';

const ITEM_SX = { minHeight: 44 } as const;

/**
 * `다른 Day로`의 Day 목록: `Day 2 10.24(토)` …(`exclude` Day는 뺀다). 행 메뉴와 지도 위 카드가 함께 쓴다.
 */
export function OtherDayMenu({
  trip,
  exclude,
  anchorEl,
  onPick,
  onClose,
}: {
  trip: Trip;
  exclude: number;
  anchorEl: HTMLElement | null;
  onPick(dayIndex: number): void;
  onClose(): void;
}) {
  const dates = tripDates(trip);
  return (
    <Menu anchorEl={anchorEl} open={anchorEl !== null} onClose={onClose}>
      {trip.days.map((_, d) =>
        d === exclude ? null : (
          <MenuItem key={d} onClick={() => onPick(d)} sx={ITEM_SX}>
            {`Day ${d + 1} ${dates[d] === undefined ? '' : shortDate(dates[d])}`}
          </MenuItem>
        ),
      )}
    </Menu>
  );
}

function MenuButton({
  name,
  open,
  onOpen,
}: {
  name: string;
  open: boolean;
  onOpen(anchor: HTMLElement): void;
}) {
  return (
    <IconButton
      aria-label={`${name} 메뉴`}
      aria-haspopup="menu"
      aria-expanded={open ? 'true' : undefined}
      onClick={(event) => onOpen(event.currentTarget)}
      sx={{ flex: 'none', width: 44, height: 44 }}
    >
      <EllipsisIcon aria-hidden="true" width={20} height={20} />
    </IconButton>
  );
}

/**
 * 시간표 행 메뉴(스펙 §2.3, 끌기의 키보드 대신): `위로`·`아래로`(보이는 이웃 행의 자리로)·`다른 Day로`(그 Day 끝)·
 * `후보로 빼기`. 모두 되돌리기 토스트를 띄운다.
 */
export function StopMenu({
  trip,
  dayIndex,
  name,
  stopId,
  prevStopId,
  nextStopId,
}: {
  trip: Trip;
  dayIndex: number;
  name: string;
  stopId: string;
  /** 바로 위·아래에 보이는 행의 Stop. 없으면 그 방향은 끈다. */
  prevStopId: string | null;
  nextStopId: string | null;
}) {
  const { run } = useTripUndo(trip.id);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [view, setView] = useState<'main' | 'days' | null>(null);
  const close = () => setView(null);
  const act = (op: TripOp, message: string) => {
    close();
    void run(op, message);
  };

  return (
    <>
      <MenuButton
        name={name}
        open={view !== null}
        onOpen={(el) => {
          setAnchor(el);
          setView('main');
        }}
      />
      <Menu anchorEl={anchor} open={view === 'main'} onClose={close}>
        <MenuItem
          disabled={prevStopId === null}
          onClick={() =>
            prevStopId !== null &&
            act(moveOnto(trip.id, stopId, dayIndex, prevStopId), movedMessage(dayIndex))
          }
          sx={ITEM_SX}
        >
          위로
        </MenuItem>
        <MenuItem
          disabled={nextStopId === null}
          onClick={() =>
            nextStopId !== null &&
            act(moveOnto(trip.id, stopId, dayIndex, nextStopId), movedMessage(dayIndex))
          }
          sx={ITEM_SX}
        >
          아래로
        </MenuItem>
        <MenuItem
          aria-haspopup="menu"
          disabled={trip.days.length < 2}
          onClick={() => setView('days')}
          sx={ITEM_SX}
        >
          다른 Day로
        </MenuItem>
        <MenuItem
          onClick={() => act(unschedule(trip.id, stopId), UNSCHEDULED_MESSAGE)}
          sx={ITEM_SX}
        >
          후보로 빼기
        </MenuItem>
      </Menu>
      <OtherDayMenu
        trip={trip}
        exclude={dayIndex}
        anchorEl={view === 'days' ? anchor : null}
        onPick={(d) => act(moveToEnd(trip.id, stopId, d), movedMessage(d))}
        onClose={close}
      />
    </>
  );
}

/** 후보 행 메뉴: `Day <N>에 넣기`(지금 Day 끝)·`후보에서 빼기`(여행에서 뺀다). 모두 되돌리기 토스트를 띄운다. */
export function CandidateMenu({
  tripId,
  dayIndex,
  name,
  placeId,
}: {
  tripId: string;
  dayIndex: number;
  name: string;
  placeId: string;
}) {
  const { run } = useTripUndo(tripId);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const act = (op: TripOp, message: string) => {
    setAnchor(null);
    void run(op, message);
  };
  return (
    <>
      <MenuButton name={name} open={anchor !== null} onOpen={setAnchor} />
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        <MenuItem
          onClick={() => act(insertAtEnd(tripId, placeId, dayIndex), insertedMessage(dayIndex))}
          sx={ITEM_SX}
        >
          {`Day ${dayIndex + 1}에 넣기`}
        </MenuItem>
        <MenuItem onClick={() => act(dropCandidate(tripId, placeId), REMOVED_MESSAGE)} sx={ITEM_SX}>
          후보에서 빼기
        </MenuItem>
      </Menu>
    </>
  );
}
