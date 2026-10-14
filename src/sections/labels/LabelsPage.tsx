import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Box from '@mui/material/Box';
import { useAtomValue } from 'jotai';
import { useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { GripIcon, LabelGlyph } from 'src/components/icons';
import { useDocumentTitle } from 'src/lib/use-document-title';
import { createLabel, deleteLabel, mergeLabels, reorderLabels } from 'src/domain/library/ops';
import { liveLabels, livePlaces } from 'src/domain/library/query';
import { LIBRARY_LIMITS, type Label } from 'src/schema/library';
import { DeleteLabelDialog } from 'src/sections/labels/DeleteLabelDialog';
import { LabelEditor } from 'src/sections/labels/LabelEditor';
import { MergeDialog } from 'src/sections/labels/MergeDialog';
import { labelRejectionMessage } from 'src/sections/labels/rejection-message';
import { labelColors } from 'src/sections/library/label-style';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';

const INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    '순서를 바꾸려면 스페이스바를 눌러 집고, 위·아래 화살표로 옮긴 뒤 스페이스바로 놓으세요. 취소는 Esc입니다.',
};

/** 드래그 중 스크린리더 안내(기본값은 영어라서 한국어로 바꾼다). */
function announcements(names: ReadonlyMap<string, string>): Announcements {
  const name = (id: string | number) => names.get(String(id)) ?? '';
  return {
    onDragStart: ({ active }) => `‘${name(active.id)}’ 라벨을 집었어요.`,
    onDragOver: ({ active, over }) =>
      over ? `‘${name(active.id)}’ 라벨이 ‘${name(over.id)}’ 위치로 이동했어요.` : undefined,
    onDragEnd: ({ active, over }) =>
      over ? `‘${name(active.id)}’ 라벨을 ‘${name(over.id)}’ 위치에 놓았어요.` : undefined,
    onDragCancel: ({ active }) => `‘${name(active.id)}’ 라벨 이동을 취소했어요.`,
  };
}

type RowProps = { label: Label; count: number; onOpen(): void };

/** 라벨 한 줄: 드래그 손잡이 · 아이콘 · 이름 · 장소 수 · 색 점. 손잡이 말고 줄을 누르면 편집기가 열린다. */
function LabelRow({ label, count, onOpen }: RowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: label.id });
  const tone = labelColors(label.color.value);
  const name = label.name.value;
  return (
    <Box
      component="li"
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        listStyle: 'none',
        position: 'relative',
        zIndex: isDragging ? 1 : 'auto',
        borderBottom: '1px solid var(--tm-border)',
        bgcolor: isDragging ? 'var(--tm-bg-raised)' : 'transparent',
        boxShadow: isDragging ? 'var(--tm-shadow-2)' : 'none',
      }}
    >
      <Box
        component="button"
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`‘${name}’ 순서 바꾸기`}
        sx={{
          flex: 'none',
          width: 44,
          height: 56,
          display: 'grid',
          placeItems: 'center',
          border: 0,
          background: 'transparent',
          color: 'var(--tm-text-muted)',
          cursor: 'grab',
          // 손잡이에서만 드래그가 시작되므로 줄 나머지 부분은 평소처럼 스크롤된다.
          touchAction: 'none',
          '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: -2 },
          '& svg': { width: 20, height: 20 },
        }}
      >
        <GripIcon aria-hidden="true" />
      </Box>
      <Box
        component="button"
        type="button"
        onClick={onOpen}
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 56,
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          pr: 2,
          border: 0,
          background: 'transparent',
          font: 'inherit',
          color: 'var(--tm-text-primary)',
          textAlign: 'left',
          cursor: 'pointer',
          '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: -2 },
        }}
      >
        <Box
          component="span"
          sx={{
            flex: 'none',
            display: 'grid',
            placeItems: 'center',
            width: 32,
            height: 32,
            borderRadius: 'var(--tm-radius-md)',
            bgcolor: tone.fill,
            color: tone.text,
            '& svg': { width: 18, height: 18 },
          }}
        >
          <LabelGlyph name={label.icon.value} />
        </Box>
        <Box
          component="span"
          sx={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontWeight: 700,
          }}
        >
          {name}
        </Box>
        <Box
          component="span"
          sx={{ flex: 'none', fontSize: 13, color: 'var(--tm-text-secondary)' }}
        >
          {`장소 ${count}곳`}
        </Box>
        <Box
          component="span"
          aria-hidden="true"
          sx={{ flex: 'none', width: 12, height: 12, borderRadius: '50%', bgcolor: tone.marker }}
        />
      </Box>
    </Box>
  );
}

type Open = { kind: 'edit' | 'merge' | 'delete'; id: string };

/** `/labels`: 라벨을 만들고, 순서를 바꾸고(드래그·키보드), 이름·색·아이콘을 고치고, 합치거나 지운다. */
export function LabelsPage() {
  useDocumentTitle('라벨 관리');
  const library = useAtomValue(libraryAtom);
  const { run } = useLibraryAction();
  const labels = useMemo(() => liveLabels(library), [library]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const place of livePlaces(library)) {
      for (const id of place.labelIds.value) map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [library]);
  const names = useMemo(() => new Map(labels.map((l) => [l.id, l.name.value])), [labels]);

  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Open | null>(null);
  const target = dialog === null ? undefined : labels.find((l) => l.id === dialog.id);

  const sensors = useSensors(
    // 손잡이에서만 시작하고, 조금 움직여야 드래그로 본다(탭과 구분). 터치는 손잡이의 `touch-action: none`으로 받는다.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = labels.map((l) => l.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const ordered = arrayMove(ids, from, to);
    void run((lib, ctx) => reorderLabels(lib, ordered, ctx));
  };

  const create = async () => {
    const result = await run((lib, ctx) => createLabel(lib, newName, ctx));
    if (result.ok) {
      setNewName('');
      setCreateError(null);
    } else {
      setCreateError(labelRejectionMessage(result.error));
    }
  };

  const onCreateKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void create();
  };

  const confirm = async (op: Parameters<typeof run>[0]) => {
    const result = await run(op);
    if (result.ok) setDialog(null);
  };

  return (
    <Box sx={{ maxWidth: 640, mx: 'auto', px: 2, py: 2 }}>
      <Box component="h1" sx={{ m: 0, mb: 2, fontSize: 20, fontWeight: 800 }}>
        라벨 관리
      </Box>

      <Box
        component="form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void create();
        }}
        sx={{ display: 'flex', gap: 1 }}
      >
        <Box
          component="input"
          type="text"
          aria-label="새 라벨 이름"
          placeholder="새 라벨 이름"
          autoComplete="off"
          aria-invalid={createError !== null}
          value={newName}
          onChange={(event) => {
            setNewName(event.target.value);
            setCreateError(null);
          }}
          onKeyDown={onCreateKeyDown}
          sx={{
            flex: 1,
            minWidth: 0,
            boxSizing: 'border-box',
            minHeight: 44,
            px: 1.25,
            border: '1px solid',
            borderColor: createError === null ? 'var(--tm-border)' : 'error.main',
            borderRadius: 'var(--tm-radius-md)',
            bgcolor: 'var(--tm-bg-raised)',
            color: 'var(--tm-text-primary)',
            font: 'inherit',
            fontSize: 16,
            '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: 1 },
          }}
        />
        <Box
          component="button"
          type="submit"
          sx={{
            flex: 'none',
            minWidth: 64,
            minHeight: 44,
            px: 2,
            border: 0,
            borderRadius: 'var(--tm-radius-md)',
            bgcolor: 'var(--tm-accent-main)',
            color: 'var(--tm-accent-contrast)',
            font: 'inherit',
            fontWeight: 700,
            cursor: 'pointer',
            '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: 2 },
          }}
        >
          추가
        </Box>
      </Box>
      <Box sx={{ mt: 0.5, minHeight: 18, fontSize: 12, color: 'var(--tm-text-muted)' }}>
        {createError === null ? (
          `이름은 1–${LIBRARY_LIMITS.labelNameChars}자`
        ) : (
          <Box component="span" role="alert" sx={{ color: 'error.main' }}>
            {createError}
          </Box>
        )}
      </Box>

      {labels.length === 0 ? (
        <Box sx={{ py: 6, textAlign: 'center', color: 'var(--tm-text-secondary)' }}>
          라벨이 아직 없어요. 위에서 이름을 입력해 만들어 보세요.
        </Box>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            screenReaderInstructions: INSTRUCTIONS,
            announcements: announcements(names),
          }}
        >
          <SortableContext items={labels.map((l) => l.id)} strategy={verticalListSortingStrategy}>
            <Box
              component="ul"
              aria-label="라벨 목록"
              sx={{ m: 0, mt: 1, p: 0, borderTop: '1px solid var(--tm-border)' }}
            >
              {labels.map((label) => (
                <LabelRow
                  key={label.id}
                  label={label}
                  count={counts.get(label.id) ?? 0}
                  onOpen={() => setDialog({ kind: 'edit', id: label.id })}
                />
              ))}
            </Box>
          </SortableContext>
        </DndContext>
      )}

      {target !== undefined && dialog?.kind === 'edit' && (
        <LabelEditor
          key={target.id}
          label={target}
          canMerge={labels.length > 1}
          onClose={() => setDialog(null)}
          onMerge={() => setDialog({ kind: 'merge', id: target.id })}
          onDelete={() => setDialog({ kind: 'delete', id: target.id })}
        />
      )}
      {target !== undefined && dialog?.kind === 'merge' && (
        <MergeDialog
          from={target}
          targets={labels.filter((l) => l.id !== target.id)}
          counts={counts}
          onCancel={() => setDialog(null)}
          onConfirm={(intoId) =>
            void confirm((lib, ctx) => mergeLabels(lib, target.id, intoId, ctx))
          }
        />
      )}
      {target !== undefined && dialog?.kind === 'delete' && (
        <DeleteLabelDialog
          label={target}
          placeCount={counts.get(target.id) ?? 0}
          onCancel={() => setDialog(null)}
          onConfirm={() => void confirm((lib, ctx) => deleteLabel(lib, target.id, ctx))}
        />
      )}
    </Box>
  );
}
