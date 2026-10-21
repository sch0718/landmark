import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import { useId, useRef, useState } from 'react';
import { fieldSx } from 'src/components/field-style';
import { LabelGlyph } from 'src/components/icons';
import type { LibraryQuery } from 'src/domain/library/query';
import type { Label } from 'src/schema/library';
import { labelColors } from 'src/sections/library/label-style';
import { useLayout } from 'src/sections/shell/use-layout';

type Props = {
  open: boolean;
  onClose(): void;
  query: LibraryQuery;
  onChange(patch: Partial<LibraryQuery>): void;
  labels: Label[];
  counts: ReadonlyMap<string, number>;
};

/** 라벨 거르기 전용 창. 선택은 기존 질의에 즉시 반영하며 정렬·검색은 저장하지 않는다. */
export function LabelFilterDialog({ open, onClose, query, onChange, labels, counts }: Props) {
  const compact = useLayout() === 'compact';
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [sort, setSort] = useState('order');
  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) {
    setSeenOpen(open);
    if (open) {
      setText('');
      setSort('order');
    }
  }
  const needle = text.trim().normalize('NFC').toLocaleLowerCase('ko-KR');
  const shown = labels.filter((l) =>
    l.name.value.normalize('NFC').toLocaleLowerCase('ko-KR').includes(needle),
  );
  if (sort === 'count')
    shown.sort(
      (a, b) =>
        (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) ||
        a.order.value - b.order.value ||
        a.id.localeCompare(b.id),
    );
  const toggle = (id: string) =>
    onChange({
      unlabeled: false,
      labelIds: query.labelIds.includes(id)
        ? query.labelIds.filter((x) => x !== id)
        : [...query.labelIds, id],
    });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby={titleId}
      fullWidth
      maxWidth="xs"
      slotProps={{
        transition: {
          onEntered: () => {
            if (!compact) searchRef.current?.focus();
          },
        },
        container: { sx: compact ? { alignItems: 'flex-end' } : {} },
        paper: {
          ...{ 'data-sheet': compact ? 'true' : 'false' },
          sx: {
            bgcolor: 'var(--tm-bg-surface)',
            backgroundImage: 'none',
            maxHeight: '80dvh',
            ...(compact
              ? {
                  m: 0,
                  width: '100%',
                  maxWidth: '100%',
                  borderRadius: '20px 20px 0 0',
                  pb: 'env(safe-area-inset-bottom, 0px)',
                }
              : {}),
          },
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2, pt: 1 }}>
        <Box component="h2" id={titleId} sx={{ m: 0, flex: 1, fontSize: 18 }}>
          라벨 찾기
        </Box>
        <Button onClick={onClose} sx={{ minHeight: 44 }}>
          완료
        </Button>
      </Box>
      <Box sx={{ px: 2, py: 1 }}>
        <Box
          component="input"
          type="search"
          ref={searchRef}
          aria-label="라벨 이름 검색"
          placeholder="라벨 이름 검색"
          value={text}
          onChange={(e) => setText(e.target.value)}
          sx={fieldSx()}
        />
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <Box
            component="select"
            aria-label="라벨 정렬"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            sx={fieldSx()}
          >
            <option value="order">내 순서</option>
            <option value="count">많은 순</option>
          </Box>
          <Box
            component="select"
            aria-label="라벨 포함 조건"
            value={query.mode}
            onChange={(e) => onChange({ mode: e.target.value as LibraryQuery['mode'] })}
            sx={fieldSx()}
          >
            <option value="any">하나라도</option>
            <option value="all">모두 포함</option>
          </Box>
        </Box>
      </Box>
      <Box sx={{ minHeight: 0, overflowY: 'auto', px: 2, pb: 2 }}>
        {shown.length === 0 && (
          <Box component="p" role="status">
            맞는 라벨이 없어요
          </Box>
        )}
        {shown.map((label) => (
          <Box
            component="label"
            key={label.id}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 44, cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={query.labelIds.includes(label.id)}
              onChange={() => toggle(label.id)}
            />
            <Box
              component="span"
              sx={{ display: 'inline-flex', color: labelColors(label.color.value).marker }}
            >
              <LabelGlyph name={label.icon.value} size={18} />
            </Box>
            <Box component="span" sx={{ flex: 1, overflowWrap: 'anywhere' }}>
              {label.name.value}
            </Box>{' '}
            <Box component="span" sx={{ whiteSpace: 'nowrap', color: 'var(--tm-text-secondary)' }}>
              {counts.get(label.id) ?? 0}곳
            </Box>
          </Box>
        ))}
      </Box>
    </Dialog>
  );
}
