import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  TouchSensor,
  useDroppable,
  useDndContext,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type Over,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import Box from '@mui/material/Box';
import Tab, { type TabProps } from '@mui/material/Tab';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GripIcon } from 'src/components/icons';
import { objectParticle } from 'src/sections/trips/planner/format';
import {
  insertAt,
  insertAtEnd,
  insertedMessage,
  moveOnto,
  moveToEnd,
  movedMessage,
  unschedule,
  UNSCHEDULED_MESSAGE,
} from 'src/sections/trips/planner/stop-ops';
import { useTripUndo, type TripOp } from 'src/sections/trips/planner/use-trip-undo';

// 계획 화면의 끌어 옮기기(스펙 §2.3): 시간표 안 순서, 후보 행 → 시간표의 자리, 시간표 행 → 후보 칸,
// 행 → Day 탭(그 Day 끝). 키보드로는 손잡이에서 스페이스 → 화살표 → 스페이스(행 메뉴로도 같은 일을 한다).

/** 끄는 것. `name`은 끌기 겹과 스크린리더 안내에 쓴다. */
export type DragItem =
  | { kind: 'stop'; stopId: string; placeId: string; dayIndex: number; name: string }
  | { kind: 'candidate'; placeId: string; name: string };

/**
 * 놓는 곳. 시간표 행(그 자리), Day 탭(그 Day 끝), 시간표 목록의 빈 곳(그 Day 끝), 후보 칸(후보 행 위도 같다).
 * 행은 끄는 것이자 놓는 곳이라 같은 데이터를 쓴다.
 */
export type DropTarget =
  | { kind: 'stop'; stopId: string; dayIndex: number; name: string }
  | { kind: 'candidate'; placeId: string; name: string }
  | { kind: 'day'; dayIndex: number }
  | { kind: 'day-end'; dayIndex: number }
  | { kind: 'candidates' };

type Drop = { op: TripOp; message: string };

/** 놓았을 때 할 연산과 되돌리기 토스트 문구. 할 일이 없으면 null. */
export function dropAction(
  tripId: string,
  item: DragItem | undefined,
  target: DropTarget | undefined,
): Drop | null {
  if (item === undefined || target === undefined) return null;
  if (item.kind === 'candidate') {
    switch (target.kind) {
      case 'stop':
        return {
          op: insertAt(tripId, item.placeId, target.dayIndex, target.stopId),
          message: insertedMessage(target.dayIndex),
        };
      case 'day':
      case 'day-end':
        return {
          op: insertAtEnd(tripId, item.placeId, target.dayIndex),
          message: insertedMessage(target.dayIndex),
        };
      case 'candidate':
      case 'candidates':
        return null;
    }
  }
  switch (target.kind) {
    case 'stop':
      if (target.stopId === item.stopId) return null;
      return {
        op:
          target.dayIndex === item.dayIndex
            ? moveOnto(tripId, item.stopId, item.dayIndex, target.stopId)
            : insertAt(tripId, item.placeId, target.dayIndex, target.stopId),
        message: movedMessage(target.dayIndex),
      };
    case 'day':
      // 자기 Day 탭에 놓으면 그대로 둔다.
      if (target.dayIndex === item.dayIndex) return null;
      return {
        op: moveToEnd(tripId, item.stopId, target.dayIndex),
        message: movedMessage(target.dayIndex),
      };
    case 'day-end':
      return {
        op: moveToEnd(tripId, item.stopId, target.dayIndex),
        message: movedMessage(target.dayIndex),
      };
    case 'candidate':
    case 'candidates':
      return { op: unschedule(tripId, item.stopId), message: UNSCHEDULED_MESSAGE };
  }
}

const itemOf = (active: Active | null): DragItem | undefined =>
  active?.data.current as DragItem | undefined;
const targetOf = (over: Over | null): DropTarget | undefined =>
  over?.data.current as DropTarget | undefined;

function targetLabel(target: DropTarget | undefined): string {
  switch (target?.kind) {
    case 'stop':
      return `‘${target.name}’ 자리`;
    case 'day':
      return `Day ${target.dayIndex + 1}`;
    case 'day-end':
      return `Day ${target.dayIndex + 1} 끝`;
    case 'candidate':
    case 'candidates':
      return '후보 칸';
    case undefined:
      return '';
  }
}

const INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    '옮기려면 스페이스바를 눌러 집고, 화살표로 시간표의 자리·Day 탭·후보 칸을 고른 뒤 스페이스바로 놓으세요. 취소는 Esc입니다. 행 메뉴로도 옮길 수 있어요.',
};

/** 드래그 중 스크린리더 안내(기본값은 영어라서 한국어로 바꾼다). */
const ANNOUNCEMENTS: Announcements = {
  onDragStart: ({ active }) => {
    const name = itemOf(active)?.name ?? '';
    return `‘${name}’${objectParticle(name)} 집었어요.`;
  },
  onDragOver: ({ over }) => (over ? `${targetLabel(targetOf(over))} 위에 있어요.` : undefined),
  onDragEnd: ({ over }) =>
    over ? `${targetLabel(targetOf(over))}에 놓았어요.` : '놓을 곳이 없어 그대로 두었어요.',
  onDragCancel: () => '옮기기를 그만두었어요.',
};

const kindOf = (data: { current?: unknown }) => (data.current as DropTarget | undefined)?.kind;

/**
 * 포인터는 놓인 곳(행·탭·후보 칸)을 그대로 쓴다. 시간표 목록 안의 빈 곳(구간 행 위 등)이면 가장 가까운 행, 행이 없는
 * 빈 Day면 그 Day 끝이다. 키보드(포인터 없음)는 가장 가까운 놓는 곳이되 목록 자체(끝)는 빼고 행·탭·후보 칸만 본다.
 */
const collision: CollisionDetection = (args) => {
  if (args.pointerCoordinates === null) {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => kindOf(c.data) !== 'day-end'),
    });
  }
  const hits = pointerWithin(args);
  const exact = hits.filter((hit) => {
    const container = args.droppableContainers.find((c) => c.id === hit.id);
    return container !== undefined && kindOf(container.data) !== 'day-end';
  });
  if (exact.length > 0) return exact;
  if (hits.length === 0) return [];
  const rows = args.droppableContainers.filter((c) => kindOf(c.data) === 'stop');
  return rows.length > 0 ? closestCenter({ ...args, droppableContainers: rows }) : hits;
};

/** 포인터 센서에서 터치는 뺀다. 터치는 길게 누른 뒤 시작하는 터치 센서가 맡는다(스크롤과 구분). */
class MousePointerSensor extends PointerSensor {
  static override activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: (
        event: Parameters<(typeof PointerSensor.activators)[number]['handler']>[0],
        options: Parameters<(typeof PointerSensor.activators)[number]['handler']>[1],
      ) =>
        event.nativeEvent.pointerType !== 'touch' &&
        PointerSensor.activators[0]!.handler(event, options),
    },
  ];
}

/** 끄는 동안 손가락·포인터를 따라다니는 이름표. 칸의 스크롤 영역에 잘리지 않도록 문서 끝에 그린다. */
function DragChip({ name }: { name: string }) {
  return (
    <Box
      data-drag-overlay
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        maxWidth: 280,
        minHeight: 44,
        px: 1.5,
        borderRadius: 'var(--tm-radius-md)',
        bgcolor: 'var(--tm-bg-raised)',
        color: 'var(--tm-text-primary)',
        boxShadow: 'var(--tm-shadow-2)',
        fontWeight: 700,
        cursor: 'grabbing',
      }}
    >
      <GripIcon aria-hidden="true" width={16} height={16} />
      <Box
        component="span"
        sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {name}
      </Box>
    </Box>
  );
}

/**
 * 끌기 겹. 끌기가 시작되는 바로 그 렌더에 이름표가 있어야 dnd-kit이 처음 잴 때 이름표의 크기·자리를 잰다
 * (빈 겹을 재면 크기 0으로 시작한다). 그래서 상태를 따로 두지 않고 문맥의 `active`를 바로 읽는다.
 */
function DragLayer() {
  const { active } = useDndContext();
  const item = itemOf(active);
  return createPortal(
    <DragOverlay dropAnimation={null}>
      {item === undefined ? null : <DragChip name={item.name} />}
    </DragOverlay>,
    document.body,
  );
}

/** 계획 화면 전체(후보 칸·시간표·Day 탭·좁은 화면의 시트)를 감싸는 끌기 영역. */
export function PlannerDnd({ tripId, children }: { tripId: string; children: ReactNode }) {
  const { run } = useTripUndo(tripId);
  const sensors = useSensors(
    // 조금 움직여야 끌기로 본다(누르기와 구분).
    useSensor(MousePointerSensor, { activationConstraint: { distance: 5 } }),
    // 터치는 250ms 눌러야 시작한다(그 전에 움직이면 스크롤).
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const drop = dropAction(tripId, itemOf(active), targetOf(over));
    if (drop !== null) void run(drop.op, drop.message);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragEnd={onDragEnd}
      accessibility={{ screenReaderInstructions: INSTRUCTIONS, announcements: ANNOUNCEMENTS }}
    >
      {children}
      <DragLayer />
    </DndContext>
  );
}

// ---------- 행·놓는 곳 ----------

/** 시간표 행: 끌 수 있고, 다른 행·후보를 그 자리에 놓을 수 있다. */
export function useStopDrag(item: Extract<DragItem, { kind: 'stop' }>) {
  const sortable = useSortable({ id: `stop:${item.stopId}`, data: item });
  const target = targetOf(sortable.over);
  const dragged = itemOf(sortable.active);
  // 놓을 자리 표시: 같은 Day에서 아래로 끌면 이 행 뒤, 그 밖(위로·후보에서)은 이 행 앞.
  const marker: 'before' | 'after' | null =
    !sortable.isOver || dragged === undefined || target?.kind !== 'stop'
      ? null
      : dragged.kind === 'stop' && dragged.stopId === item.stopId
        ? null
        : dragged.kind === 'stop' &&
            sortable.activeIndex >= 0 &&
            sortable.activeIndex < sortable.index
          ? 'after'
          : 'before';
  return { ...sortable, marker };
}

/**
 * 후보 행: 끌 수 있고, 시간표 행을 놓으면 후보로 뺀다(후보 칸에 놓은 것과 같다). 후보끼리 순서는 바꾸지 않는다.
 * 키보드 끌기(`sortableKeyboardCoordinates`)는 끄는 것도 놓는 곳이어야 움직이므로 정렬 항목으로 둔다.
 */
export function useCandidateDrag(item: Extract<DragItem, { kind: 'candidate' }>) {
  return useSortable({ id: `cand:${item.placeId}`, data: item });
}

/** 놓는 곳. 지금 무엇이 그 위에 있는지(`isOver`)와 끄는 것(`dragging`)을 함께 준다. */
export function useDropTarget(id: string, target: DropTarget) {
  const { setNodeRef, isOver, active } = useDroppable({ id, data: target });
  return { setNodeRef, isOver, dragging: itemOf(active) };
}

/** 끌기 손잡이. 스페이스로 집고 화살표로 옮긴 뒤 스페이스로 놓는다. */
export function DragHandle({
  name,
  setActivatorNodeRef,
  attributes,
  listeners,
}: {
  name: string;
  setActivatorNodeRef(element: HTMLElement | null): void;
  attributes: object;
  listeners: object | undefined;
}) {
  return (
    <Box
      component="button"
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`${name} 끌어 옮기기`}
      // dnd-kit 기본값(`sortable`)은 영어로 읽힌다.
      aria-roledescription="옮길 수 있는 항목"
      sx={{
        flex: 'none',
        width: 32,
        minHeight: 44,
        display: 'grid',
        placeItems: 'center',
        p: 0,
        border: 0,
        background: 'transparent',
        color: 'var(--tm-text-muted)',
        cursor: 'grab',
        // 손잡이에서만 끌기가 시작되므로 행의 나머지 부분은 평소처럼 스크롤된다.
        touchAction: 'none',
        borderRadius: 'var(--tm-radius-sm)',
        '&:focus-visible': { outlineOffset: -2 },
      }}
    >
      <GripIcon aria-hidden="true" width={18} height={18} />
    </Box>
  );
}

/** 놓을 수 있는 탭(Day 탭·시트의 `후보 N` 탭). MUI `Tabs`가 넘기는 속성을 그대로 `Tab`에 준다. */
export function DropTab({
  dropId,
  target,
  sx,
  ...tabProps
}: TabProps & { dropId: string; target: DropTarget }) {
  const { setNodeRef, isOver, dragging } = useDropTarget(dropId, target);
  const active = isOver && dragging !== undefined;
  return (
    <Tab
      ref={setNodeRef}
      {...tabProps}
      sx={[
        active && {
          bgcolor: 'var(--tm-bg-raised)',
          outline: '2px solid var(--tm-accent-main)',
          outlineOffset: -2,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
}
