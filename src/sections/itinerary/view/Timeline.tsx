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
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Fragment, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { overlay } from 'src/domain/overlay';
import { HHmm, LIMITS } from 'src/schema/common';
import type { Stop, TripData } from 'src/schema/trip-data';
import { circled, dayLabel } from 'src/sections/itinerary/store/format';
import {
  moveStop,
  removeStop,
  reorderStops,
  updateStop,
} from 'src/sections/itinerary/store/itinerary-actions';
import { useItinerarySave, type ItineraryDay } from 'src/sections/itinerary/store/itinerary-state';
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
                <StopRow trip={trip} date={date} stop={stop} position={i} />
                {leg && <LegRow leg={leg} />}
              </Fragment>
            );
          })}
        </Box>
      </SortableContext>
    </DndContext>
  );
}

type RowProps = { trip: TripData; date: string; stop: Stop; position: number };

function StopRow({ trip, date, stop, position }: RowProps) {
  const save = useItinerarySave();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
    useSortable({ id: stop.id });
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
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
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <IconButton
          size="small"
          ref={setActivatorNodeRef}
          aria-label={`${name} 순서 바꾸기`}
          sx={{ cursor: 'grab', touchAction: 'none' }}
          {...attributes}
          {...listeners}
        >
          ⠿
        </IconButton>
        <Typography component="span" sx={{ fontWeight: 700 }} aria-hidden>
          {circled(position + 1)}
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
            {stop.time && (
              <Typography component="span" variant="body2" color="primary">
                {stop.time}
              </Typography>
            )}
            <Typography component="span" variant="body1" noWrap>
              {name}
            </Typography>
          </Stack>
          {stop.note && (
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
              {stop.note}
            </Typography>
          )}
        </Box>
        <Button size="small" aria-label={`${name} 편집`} onClick={() => setEditing(true)}>
          편집
        </Button>
        <IconButton
          size="small"
          aria-label={`${name} 메뉴`}
          onClick={(e) => setMenuAnchor(e.currentTarget)}
        >
          ⋯
        </IconButton>
        <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}>
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
      {editing && (
        <StopEditor
          name={name}
          stop={stop}
          onCancel={() => setEditing(false)}
          onSave={(patch) => {
            setEditing(false);
            save((t, e, now) => updateStop(t, e, date, stop.id, patch, now));
          }}
        />
      )}
    </Box>
  );
}

type EditorProps = {
  name: string;
  stop: Stop;
  onCancel(): void;
  onSave(patch: { time: string | null; note: string | null }): void;
};

/** 시간·메모 인라인 편집. 빈 값이면 그 필드를 지운다. */
function StopEditor({ name, stop, onCancel, onSave }: EditorProps) {
  const [time, setTime] = useState(stop.time ?? '');
  const [note, setNote] = useState(stop.note ?? '');
  const [timeError, setTimeError] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = time.trim();
    if (t !== '' && !HHmm.safeParse(t).success) {
      setTimeError(true);
      return;
    }
    const n = note.trim();
    onSave({ time: t === '' ? null : t, note: n === '' ? null : n });
  };

  return (
    <Box component="form" onSubmit={submit} sx={{ pl: 5, pt: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          size="small"
          label="시간"
          placeholder="HH:mm"
          value={time}
          onChange={(e) => {
            setTime(e.target.value);
            setTimeError(false);
          }}
          error={timeError}
          helperText={timeError ? '시간은 HH:mm 형식으로 입력하세요' : undefined}
          slotProps={{ htmlInput: { 'aria-label': `${name} 시간` } }}
          sx={{ width: 110 }}
        />
        <TextField
          size="small"
          label="메모"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          multiline
          slotProps={{ htmlInput: { 'aria-label': `${name} 메모` } }}
          sx={{ flex: 1 }}
        />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', pt: 0.5 }}>
        <Button size="small" onClick={onCancel}>
          취소
        </Button>
        <Button size="small" type="submit" variant="contained">
          저장
        </Button>
      </Stack>
    </Box>
  );
}
