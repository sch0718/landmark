import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { LabelGlyph } from 'src/components/icons';
import type { LibraryQuery } from 'src/domain/library/query';
import type { Label } from 'src/schema/library';
import { labelColors } from 'src/sections/library/label-style';

export type OverviewProps = {
  /** 살아 있는 라벨, 보관함의 라벨 순서. */
  labels: Label[];
  /** `labelCounts` 결과. 라벨 없음은 `'unlabeled'` 키. */
  counts: ReadonlyMap<string, number>;
  query: LibraryQuery;
  onSelect(patch: Partial<LibraryQuery>): void;
};

export const UNLABELED = 'unlabeled';

/**
 * 블록 하나를 눌렀을 때의 조건 변경. 블록은 라벨을 하나만 고른다(`labelIds: [그 라벨]`).
 * 이미 그 블록만 골라져 있으면 다시 눌러 푼다.
 */
export function blockPatch(target: string, query: LibraryQuery): Partial<LibraryQuery> {
  if (target === UNLABELED) {
    return query.unlabeled ? { unlabeled: false } : { unlabeled: true, labelIds: [] };
  }
  const only = !query.unlabeled && query.labelIds.length === 1 && query.labelIds[0] === target;
  return only ? { labelIds: [] } : { labelIds: [target], unlabeled: false };
}

export function isBlockSelected(target: string, query: LibraryQuery): boolean {
  return target === UNLABELED
    ? query.unlabeled
    : !query.unlabeled && query.labelIds.length === 1 && query.labelIds[0] === target;
}

/** 라벨 블록(벤토·타일 공용). 색·아이콘·개수를 보여 주는 토글 버튼이다. */
export function LabelBlock({
  label,
  count,
  selected,
  onClick,
  sx,
}: {
  /** `null`이면 `미분류` 블록. */
  label: Label | null;
  count: number;
  selected: boolean;
  onClick(): void;
  sx?: SxProps<Theme>;
}) {
  const color = label === null ? null : labelColors(label.color.value);
  return (
    <Box
      component="button"
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      sx={[
        {
          position: 'relative',
          minWidth: 0,
          minHeight: 78,
          boxSizing: 'border-box',
          p: 1.5,
          border: '2px solid',
          borderColor: selected ? 'var(--tm-accent-main)' : 'transparent',
          borderRadius: 'var(--tm-radius-lg)',
          bgcolor: color?.fill ?? 'var(--tm-bg-raised)',
          color: color?.text ?? 'var(--tm-text-secondary)',
          boxShadow: color === null ? 'inset 0 0 0 1px var(--tm-border)' : 'none',
          font: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
          overflow: 'hidden',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Box
        component="span"
        sx={{
          display: 'block',
          pr: label === null ? 0 : 4.5,
          fontWeight: 800,
          fontSize: 15,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label === null ? '미분류' : label.name.value}
      </Box>
      <Box component="span" sx={{ display: 'block', mt: 0.25, fontSize: 12 }}>
        {count}곳
      </Box>
      {label !== null && (
        <Box
          component="span"
          aria-hidden="true"
          sx={{
            position: 'absolute',
            right: 10,
            bottom: 10,
            width: 30,
            height: 30,
            borderRadius: '10px',
            bgcolor: 'rgba(255,255,255,.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
          }}
        >
          <LabelGlyph name={label.icon.value} size={18} />
        </Box>
      )}
    </Box>
  );
}
