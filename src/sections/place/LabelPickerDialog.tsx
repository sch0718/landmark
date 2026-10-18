import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import { useAtomValue } from 'jotai';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { fieldSx } from 'src/components/field-style';
import { LabelGlyph, PlusIcon } from 'src/components/icons';
import { LABEL_NAME_RANGE_MESSAGE, type Label } from 'src/schema/library';
import { labelColors } from 'src/sections/library/label-style';
import {
  arrangeLabels,
  canCreateLabel,
  countLabelUses,
  filterLabels,
  orderLabelsForPicker,
} from 'src/sections/place/label-picker-order';
import { useLayout } from 'src/sections/shell/use-layout';
import { libraryAtom, type LibraryActionResult } from 'src/stores/library-state';

type Props = {
  open: boolean;
  onClose(): void;
  /** 붙일 수 있는 라벨(살아 있는 모든 라벨, 순서대로). */
  labels: Label[];
  /** 이 장소에 붙은 라벨 id. */
  attachedIds: readonly string[];
  /**
   * 라벨을 켜거나 끈다. 실패는 호출한 쪽이 알린다(토스트). 저장 결과를 돌려주면 실패했을 때 누른 체크를 되돌린다
   * (추가 카드처럼 바로 반영하는 쪽은 돌려주지 않는다).
   */
  onToggle(labelId: string): void | Promise<LibraryActionResult>;
  /** 이름으로 라벨을 만들어(같은 이름이 있으면 그것을) 붙인다. */
  onCreate(name: string): Promise<LibraryActionResult>;
};

/** 연산이 거절한 이유를 검색 칸 아래에 보일 문구로 바꾼다. 저장소 오류 같은 나머지는 `run`이 토스트로 알린다. */
function rejectionMessage(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('_tag' in error)) return null;
  switch (error._tag) {
    case 'LabelNameInvalid':
      return LABEL_NAME_RANGE_MESSAGE;
    case 'LabelNameTaken':
      return '같은 이름의 라벨이 있어요';
    case 'NotFound':
      return '장소를 찾을 수 없어요';
    default:
      return null;
  }
}

const ROW_SX = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  width: '100%',
  minHeight: 44,
  px: 1,
  border: 0,
  borderRadius: 'var(--tm-radius-md)',
  background: 'transparent',
  color: 'var(--tm-text-primary)',
  font: 'inherit',
  fontSize: 15,
  textAlign: 'left',
  cursor: 'pointer',
  '&:hover': { bgcolor: 'var(--tm-bg-raised)' },
} as const;

/**
 * 라벨 고르기 창(스펙 §5.2). 체크할 때마다 바로 `onToggle`을 부르고(취소 없음), 닫기는 `완료`·Esc·바깥 누르기.
 * 줄 순서는 창을 연 순간 정해 열려 있는 동안 고정한다. 검색 칸은 이름으로 거르고, 같은 이름이 없으면 새 라벨을
 * 만들어 붙이는 행을 보인다(Enter도 같다).
 */
export function LabelPickerDialog({
  open,
  onClose,
  labels,
  attachedIds,
  onToggle,
  onCreate,
}: Props) {
  const compact = useLayout() === 'compact';
  const library = useAtomValue(libraryAtom);
  const titleId = useId();
  const errorId = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [prevOpen, setPrevOpen] = useState(false);
  // 누른 체크(라벨 id → 체크 여부). 저장(보관함 전체를 씀)이 끝나 `attachedIds`가 따라오기 전에도 누른 대로 보인다.
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [prevAttached, setPrevAttached] = useState(attachedIds);
  const counts = useMemo(() => countLabelUses(library), [library]);
  // 만들기가 끝나기를 기다리는 중인가(Enter 두 번·누르기 겹침 막기), 창을 연 횟수(늦게 끝난 만들기가 다시 연 창을 건드리지 않게).
  const creating = useRef(false);
  const session = useRef(0);

  // 닫힘에서 열림으로 바뀔 때만 순서를 정하고 검색을 비운다. 닫히는 동안(페이드 아웃)에는 그대로 둔다(렌더 중 상태 갱신).
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setOrder(orderLabelsForPicker(labels, attachedIds, counts));
      setText('');
      setError(null);
      setPending(new Map());
    }
  }
  // 저장된 값이 누른 체크와 같아지면 그 체크는 더 붙들지 않는다(렌더 중 상태 갱신).
  if (attachedIds !== prevAttached) {
    setPrevAttached(attachedIds);
    const saved = new Set(attachedIds);
    const left = new Map([...pending].filter(([id, checked]) => saved.has(id) !== checked));
    if (left.size !== pending.size) setPending(left);
  }
  useEffect(() => {
    if (open) session.current += 1;
  }, [open]);

  const attached = new Set(attachedIds);
  const isChecked = (id: string) => pending.get(id) ?? attached.has(id);
  const toggle = (id: string) => {
    setPending(new Map(pending).set(id, !isChecked(id)));
    const saving = onToggle(id);
    if (saving === undefined) return;
    const opened = session.current;
    void saving.then((result) => {
      // 실패하면 저장된 값으로 보이게 그 체크를 놓는다. 그사이 창을 다시 열었으면 새 체크를 건드리지 않는다.
      if (result.ok || opened !== session.current) return;
      setPending((now) => {
        if (!now.has(id)) return now;
        const next = new Map(now);
        next.delete(id);
        return next;
      });
    });
  };
  const trimmed = text.trim();
  const shown = filterLabels(arrangeLabels(labels, order), text);
  const creatable = canCreateLabel(labels, text);

  const create = async () => {
    if (creating.current) return;
    creating.current = true;
    const opened = session.current;
    try {
      const result = await onCreate(text);
      if (opened !== session.current) return;
      if (result.ok) {
        setText('');
        setError(null);
      } else {
        setError(rejectionMessage(result.error));
      }
    } finally {
      creating.current = false;
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // 한글 조합 중의 Enter는 글자를 확정하는 키라서 건너뛴다.
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void create();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby={titleId}
      fullScreen={compact}
      fullWidth
      slotProps={{
        paper: {
          sx: {
            bgcolor: 'var(--tm-bg-surface)',
            backgroundImage: 'none',
            ...(compact
              ? { pt: 'env(safe-area-inset-top, 0px)' }
              : { maxWidth: 420, maxHeight: 'min(640px, 80dvh)' }),
          },
        },
      }}
    >
      <Box sx={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 1, px: 2, pt: 1.5 }}>
        <Box component="h2" id={titleId} sx={{ m: 0, flex: 1, fontSize: 18, fontWeight: 800 }}>
          라벨 바꾸기
        </Box>
        <Button onClick={onClose} sx={{ minHeight: 44, fontWeight: 800 }}>
          완료
        </Button>
      </Box>
      <Box sx={{ flex: 'none', px: 2, pt: 1, pb: 1 }}>
        <Box
          component="input"
          type="search"
          autoFocus={!compact}
          aria-label="라벨 검색 또는 새 라벨 이름"
          placeholder="라벨 검색 또는 새 이름"
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : errorId}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          sx={fieldSx({ invalid: error !== null })}
        />
        {error !== null && (
          <Box id={errorId} role="alert" sx={{ mt: 0.5, fontSize: 12, color: 'error.main' }}>
            {error}
          </Box>
        )}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 1, pb: 2 }}>
        {creatable && (
          <Box component="button" type="button" onClick={() => void create()} sx={ROW_SX}>
            <PlusIcon aria-hidden="true" width={18} height={18} />
            {`‘${trimmed}’ 새 라벨로 붙이기`}
          </Box>
        )}
        {labels.length === 0 ? (
          <Box component="p" sx={{ m: 0, px: 1, py: 1.5, color: 'var(--tm-text-secondary)' }}>
            만든 라벨이 없어요. 검색 칸에 이름을 쓰고 Enter로 만들어요
          </Box>
        ) : shown.length === 0 ? (
          <Box component="p" sx={{ m: 0, px: 1, py: 1.5, color: 'var(--tm-text-secondary)' }}>
            {`‘${trimmed}’에 맞는 라벨이 없어요`}
          </Box>
        ) : (
          <Box role="group" aria-label="라벨 목록">
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {shown.map((label) => {
                const tone = labelColors(label.color.value);
                return (
                  <li key={label.id}>
                    <Box component="label" sx={ROW_SX}>
                      <Box
                        component="input"
                        type="checkbox"
                        checked={isChecked(label.id)}
                        onChange={() => toggle(label.id)}
                        sx={{ flex: 'none', width: 20, height: 20, m: 0, accentColor: tone.marker }}
                      />
                      <Box
                        component="span"
                        aria-hidden="true"
                        sx={{ flex: 'none', display: 'inline-flex', color: tone.marker }}
                      >
                        <LabelGlyph name={label.icon.value} size={16} />
                      </Box>
                      <Box
                        component="span"
                        data-label-name=""
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {label.name.value}
                      </Box>
                      {/* 접근 이름이 `맛집 2곳`으로 읽히게 이름과 개수를 `inline`이 아닌 요소로 나눈다(flex 항목이라 겉모양은 같다). */}
                      <Box
                        component="span"
                        sx={{
                          flex: 'none',
                          display: 'inline-block',
                          fontSize: 13,
                          color: 'var(--tm-text-secondary)',
                        }}
                      >
                        {`${counts.get(label.id) ?? 0}곳`}
                      </Box>
                    </Box>
                  </li>
                );
              })}
            </Box>
          </Box>
        )}
      </Box>
    </Dialog>
  );
}
