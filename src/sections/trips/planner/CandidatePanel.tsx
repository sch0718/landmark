import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import { useAtomValue, useSetAtom } from 'jotai';
import { useMemo, useState, type Ref } from 'react';
import { PanelLeftCloseIcon, PlusIcon } from 'src/components/icons';
import { liveLabels } from 'src/domain/library/query';
import { regionsByPlace } from 'src/domain/library/region';
import { visibleCandidates } from 'src/domain/trips/query';
import type { Label, Place } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';
import {
  AutoSplitPreview,
  useSplitPlan,
  useStartAutoSplit,
} from 'src/sections/trips/planner/AutoSplitPreview';
import { labelColors } from 'src/sections/library/label-style';
import { placeLabels } from 'src/sections/library/place-labels';
import { objectParticle } from 'src/sections/trips/planner/format';
import { LibraryPickerDialog } from 'src/sections/trips/planner/LibraryPickerDialog';
import { DragHandle, useCandidateDrag, useDropTarget } from 'src/sections/trips/planner/PlannerDnd';
import { CandidateMenu } from 'src/sections/trips/planner/StopMenu';
import { insertAtEnd, insertedMessage } from 'src/sections/trips/planner/stop-ops';
import { useTripUndo } from 'src/sections/trips/planner/use-trip-undo';
import { periodLabel } from 'src/sections/trips/trip-dates';
import { openAddSheetAtom } from 'src/stores/add-place';
import { libraryAtom } from 'src/stores/library-state';
import { mapCardAtom } from 'src/stores/trip-planner';

function CandidateRow({
  tripId,
  place,
  region,
  label,
  dayIndex,
  onAdd,
  onOpen,
}: {
  tripId: string;
  place: Place;
  region: string;
  label: Label | undefined;
  dayIndex: number;
  onAdd(): void;
  /** 행을 누르면 지도 위 카드를 연다. */
  onOpen(): void;
}) {
  const name = place.name.value;
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } = useCandidateDrag({
    kind: 'candidate',
    placeId: place.id,
    name,
  });
  return (
    <Box
      component="li"
      ref={setNodeRef}
      sx={{
        listStyle: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        minHeight: 56,
        pl: 0.5,
        pr: 0.5,
        borderBottom: '1px solid var(--tm-border)',
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <DragHandle
        name={name}
        setActivatorNodeRef={setActivatorNodeRef}
        attributes={attributes}
        listeners={listeners}
      />
      {/* 대표 라벨 색. 라벨이 없으면 자리만 둔다. */}
      <Box
        {...(label === undefined
          ? { 'aria-hidden': true }
          : { role: 'img', 'aria-label': label.name.value })}
        sx={{
          flex: 'none',
          width: 10,
          height: 10,
          borderRadius: '50%',
          bgcolor: label === undefined ? 'transparent' : labelColors(label.color.value).marker,
        }}
      />
      <Box
        component="button"
        type="button"
        onClick={onOpen}
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 44,
          display: 'block',
          p: 0,
          border: 0,
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
          borderRadius: 'var(--tm-radius-sm)',
        }}
      >
        <Box
          component="span"
          sx={{
            display: 'block',
            fontWeight: 700,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </Box>
        <Box
          component="span"
          sx={{ display: 'block', fontSize: 12, color: 'var(--tm-text-secondary)' }}
        >
          {region}
        </Box>
      </Box>
      <IconButton
        aria-label={`${name}${objectParticle(name)} Day ${dayIndex + 1}에 넣기`}
        onClick={onAdd}
        sx={{ flex: 'none', width: 44, height: 44 }}
      >
        <PlusIcon aria-hidden="true" width={20} height={20} />
      </IconButton>
      <CandidateMenu tripId={tripId} dayIndex={dayIndex} name={name} placeId={place.id} />
    </Box>
  );
}

type Props = {
  trip: Trip;
  /** `＋`가 넣을 Day(지금 보는 Day). */
  dayIndex: number;
  /** 주어지면(중간 폭) 머리에 `후보 칸 접기` 버튼을 둔다. */
  onCollapse?: () => void;
  /** `후보 칸 접기` 버튼. 접은 뒤 펼치기 버튼에서 되돌아올 때 포커스를 주려고 계획 화면이 쥔다. */
  collapseRef?: Ref<HTMLButtonElement>;
  /** 칸 높이를 채우고 목록만 스크롤한다(넓은·중간 폭). 끄면(시트) 내용 높이대로 늘고 바깥이 스크롤한다. */
  fill?: boolean;
};

/**
 * 후보 칸(스펙 §2.3): 여행 제목·기간, `후보 N`, 후보 행(이름·지역·대표 라벨 색, `＋`로 지금 Day 끝에 넣기, 행 메뉴).
 * 후보 행은 끌어서 시간표의 자리·Day 탭에 놓을 수 있고, 시간표 행을 이 칸에 놓으면 후보로 뺀다.
 * `Day 자동 나누기`는 후보가 있으면 켜지고, 누르면 목록 자리에 미리보기(`적용`·`취소`)를 보인다.
 * `보관함에서 더하기`는 보관함 고르기 창을, `링크·핀으로 새로 추가`는 이 여행을 대상으로 붙인 ＋추가 시트를 연다(스펙 §2.2).
 */
export function CandidatePanel({ trip, dayIndex, onCollapse, collapseRef, fill = true }: Props) {
  const library = useAtomValue(libraryAtom);
  const { run } = useTripUndo(trip.id);
  const openCard = useSetAtom(mapCardAtom);
  const openAddSheet = useSetAtom(openAddSheetAtom);
  const [picking, setPicking] = useState(false);
  const {
    setNodeRef: setDropRef,
    isOver,
    dragging,
  } = useDropTarget('candidates', {
    kind: 'candidates',
  });
  const stopOver = isOver && dragging?.kind === 'stop';
  const splitPlan = useSplitPlan(trip);
  const startSplit = useStartAutoSplit(trip);

  const { candidates, regions, labelById } = useMemo(() => {
    const places = visibleCandidates(library, trip);
    return {
      candidates: places,
      regions: regionsByPlace(places),
      labelById: new Map(liveLabels(library).map((l) => [l.id, l])),
    };
  }, [library, trip]);

  const add = (placeId: string) =>
    void run(insertAtEnd(trip.id, placeId, dayIndex), insertedMessage(dayIndex));

  return (
    <Box
      component="section"
      ref={setDropRef}
      aria-label="후보 칸"
      sx={{
        ...(fill ? { height: '100%', minHeight: 0 } : {}),
        display: 'flex',
        flexDirection: 'column',
        // 시간표 행을 끌어 이 칸 위에 두면 놓을 곳임을 보인다.
        outline: stopOver ? '2px solid var(--tm-accent-main)' : 'none',
        outlineOffset: -2,
      }}
    >
      <Box sx={{ flex: 'none', display: 'flex', alignItems: 'flex-start', gap: 1, px: 2, pt: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box
            component="h1"
            sx={{ m: 0, fontSize: 18, fontWeight: 800, overflowWrap: 'anywhere' }}
          >
            {trip.title.value}
          </Box>
          <Box sx={{ mt: 0.25, fontSize: 13, color: 'var(--tm-text-secondary)' }}>
            {periodLabel(trip.startDate.value, trip.endDate.value)}
          </Box>
        </Box>
        {onCollapse !== undefined && (
          <IconButton
            ref={collapseRef}
            aria-label="후보 칸 접기"
            onClick={onCollapse}
            sx={{ width: 44, height: 44 }}
          >
            <PanelLeftCloseIcon aria-hidden="true" width={20} height={20} />
          </IconButton>
        )}
      </Box>
      <Box
        component="h2"
        sx={{ flex: 'none', m: 0, px: 2, pt: 2, pb: 1, fontSize: 14, fontWeight: 700 }}
      >
        {`후보 ${candidates.length}`}
      </Box>
      <Box
        sx={{
          ...(fill ? { flex: 1, minHeight: 0, overflow: 'auto' } : {}),
          borderTop: '1px solid var(--tm-border)',
        }}
      >
        {splitPlan !== null ? (
          <AutoSplitPreview trip={trip} plan={splitPlan} />
        ) : candidates.length === 0 ? (
          <Box sx={{ px: 2, py: 4, textAlign: 'center', color: 'var(--tm-text-muted)' }}>
            후보가 없어요
          </Box>
        ) : (
          <Box component="ul" aria-label="후보" sx={{ m: 0, p: 0 }}>
            <SortableContext
              items={candidates.map((p) => `cand:${p.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {candidates.map((place) => (
                <CandidateRow
                  key={place.id}
                  tripId={trip.id}
                  place={place}
                  region={regions.get(place.id) ?? ''}
                  label={placeLabels(place, labelById)[0]}
                  dayIndex={dayIndex}
                  onAdd={() => add(place.id)}
                  onOpen={() => openCard({ tripId: trip.id, placeId: place.id })}
                />
              ))}
            </SortableContext>
          </Box>
        )}
      </Box>
      <Box
        sx={{
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          p: 2,
          borderTop: '1px solid var(--tm-border)',
        }}
      >
        <Button
          variant="outlined"
          onClick={() => setPicking(true)}
          sx={{ minHeight: 44, textTransform: 'none' }}
        >
          보관함에서 더하기
        </Button>
        <Button
          variant="outlined"
          onClick={() => openAddSheet({ tripId: trip.id })}
          sx={{ minHeight: 44, textTransform: 'none' }}
        >
          링크·핀으로 새로 추가
        </Button>
        <Button
          variant="outlined"
          disabled={candidates.length === 0 || splitPlan !== null}
          onClick={startSplit}
          sx={{ minHeight: 44, textTransform: 'none' }}
        >
          Day 자동 나누기
        </Button>
      </Box>
      <LibraryPickerDialog open={picking} tripId={trip.id} onClose={() => setPicking(false)} />
    </Box>
  );
}
