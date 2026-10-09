import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useAtomValue, useSetAtom } from 'jotai';
import { Fragment, useState } from 'react';
import { toast } from 'sonner';
import { overlay } from 'src/domain/overlay';
import { LIMITS } from 'src/schema/common';
import type { Stop, TripData } from 'src/schema/legacy/trip-data';
import { circled, dayLabel } from 'src/sections/itinerary/store/format';
import { moveStop, removeStop, reorderStops } from 'src/sections/itinerary/store/itinerary-actions';
import { useItinerarySave, type ItineraryDay } from 'src/sections/itinerary/store/itinerary-state';
import {
  detailAtom,
  itineraryEditingAtom,
  stopDraftsAtom,
} from 'src/sections/views/store/view-session';
import { EllipsisIcon, GripIcon } from 'src/components/icons';
import { LegRow } from './LegRow';

type Props = { trip: TripData; item: ItineraryDay };

/** 하루의 타임라인: 장소 행 사이에 구간 행. 같은 날 안에서 드래그(키보드 포함)로 순서를 바꾼다. */
export function Timeline({ trip, item }: Props) {
  const save = useItinerarySave();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const { day, legs } = item;
  const date = day.date;
  // 구간은 stop id 쌍으로 찾는다(장소가 빠진 쌍은 구간이 없을 수 있어 순번으로 맞추지 않는다).
  const legBetween = new Map(legs.map((l) => [`${l.fromStopId}>${l.toStopId}`, l]));

  if (day.stops.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
        방문 없음
      </Typography>
    );
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const toIndex = day.stops.findIndex((s) => s.id === over.id);
    if (toIndex < 0) return;
    const stopId = String(active.id);
    save((t, e, now) => reorderStops(t, e, date, stopId, toIndex, now));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={day.stops.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <Box component="ol" aria-label={`${dayLabel(trip, date)} 타임라인`} sx={{ m: 0, p: 0 }}>
          {day.stops.map((stop, i) => {
            const next = day.stops[i + 1];
            const leg = next ? legBetween.get(`${stop.id}>${next.id}`) : undefined;
            return (
              <Fragment key={stop.id}>
                <StopRow
                  trip={trip}
                  date={date}
                  stop={stop}
                  position={i}
                  dayStopCount={day.stops.length}
                />
                {leg && <LegRow leg={leg} />}
              </Fragment>
            );
          })}
        </Box>
      </SortableContext>
    </DndContext>
  );
}

type RowProps = {
  trip: TripData;
  date: string;
  stop: Stop;
  position: number;
  dayStopCount: number;
};

function StopRow({ trip, date, stop, position, dayStopCount }: RowProps) {
  const save = useItinerarySave();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
    useSortable({ id: stop.id });
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const editingMode = useAtomValue(itineraryEditingAtom);
  const setDetail = useSetAtom(detailAtom);
  const setDrafts = useSetAtom(stopDraftsAtom);
  const openEditor = () => {
    setDrafts((drafts) =>
      drafts[stop.id]
        ? drafts
        : { ...drafts, [stop.id]: { date, time: stop.time ?? '', note: stop.note ?? '' } },
    );
    setDetail({ kind: 'stop', date, stopId: stop.id });
  };
  const name = trip.places[stop.placeKey]?.name ?? stop.placeKey;

  const moveTo = (toDate: string) => {
    setMenuAnchor(null);
    save((t, e, now) => {
      const count = overlay(t, e).days.find((d) => d.date === toDate)?.stops.length ?? 0;
      if (count >= LIMITS.stopsPerDay) {
        toast.error(`하루에 ${LIMITS.stopsPerDay}곳까지 넣을 수 있어요`);
        return e;
      }
      return moveStop(t, e, stop.id, date, toDate, now);
    });
  };
  const remove = () => {
    setMenuAnchor(null);
    save((t, e, now) => removeStop(t, e, date, stop.id, now));
  };

  return (
    <Box
      component="li"
      ref={setNodeRef}
      data-sortable-index={position}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{ listStyle: 'none', py: 0.5, bgcolor: 'background.paper' }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', py: 0.75 }}
        data-stop-id={stop.id}
        data-stop-name={name}
      >
        {editingMode && (
          <IconButton
            size="small"
            ref={setActivatorNodeRef}
            aria-label={`${name} 순서 바꾸기`}
            sx={{ cursor: 'grab', touchAction: 'none' }}
            {...attributes}
            {...listeners}
          >
            <GripIcon width={20} height={20} />
          </IconButton>
        )}
        <Typography component="span" sx={{ fontWeight: 700 }} aria-hidden>
          {circled(position + 1)}
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="column" spacing={0} sx={{ alignItems: 'baseline' }}>
            {stop.time && (
              <Typography component="span" variant="body2" color="primary">
                {stop.time}
              </Typography>
            )}
            <Typography
              component="span"
              variant="body1"
              sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
            >
              {name}
            </Typography>
          </Stack>
          {stop.note && (
            <Typography variant="caption" color="text.secondary" noWrap>
              {stop.note}
            </Typography>
          )}
        </Box>
        <IconButton
          size="small"
          aria-label={`${name} 메뉴`}
          onClick={(e) => setMenuAnchor(e.currentTarget)}
        >
          <EllipsisIcon width={22} height={22} />
        </IconButton>
        <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}>
          {[
            <MenuItem
              key="edit"
              onClick={() => {
                setMenuAnchor(null);
                openEditor();
              }}
            >
              시간·메모 편집
            </MenuItem>,
            <MenuItem
              key="up"
              disabled={position === 0}
              onClick={() => {
                setMenuAnchor(null);
                save((t, e, now) => reorderStops(t, e, date, stop.id, position - 1, now));
              }}
            >
              한 칸 위로
            </MenuItem>,
            <MenuItem
              key="down"
              disabled={position === dayStopCount - 1}
              onClick={() => {
                setMenuAnchor(null);
                save((t, e, now) => reorderStops(t, e, date, stop.id, position + 1, now));
              }}
            >
              한 칸 아래로
            </MenuItem>,
          ]}
          {trip.days
            .filter((d) => d.date !== date)
            .map((d) => (
              <MenuItem key={d.date} onClick={() => moveTo(d.date)}>
                {`${dayLabel(trip, d.date)}로 이동`}
              </MenuItem>
            ))}
          <MenuItem onClick={remove}>빼기</MenuItem>
        </Menu>
      </Stack>
    </Box>
  );
}
