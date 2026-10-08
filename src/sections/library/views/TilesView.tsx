import Box from '@mui/material/Box';
import {
  LabelBlock,
  UNLABELED,
  blockPatch,
  isBlockSelected,
  type OverviewProps,
} from 'src/sections/library/views/overview';

/** 타일 보기: 같은 크기의 라벨 타일 2열, 마지막이 `미분류`. */
export function TilesView({ labels, counts, query, onSelect }: OverviewProps) {
  return (
    <Box
      role="group"
      aria-label="라벨 개요"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: 1,
        px: 2,
        pt: 0.5,
        pb: 1.5,
      }}
    >
      {labels.map((label) => (
        <LabelBlock
          key={label.id}
          label={label}
          count={counts.get(label.id) ?? 0}
          selected={isBlockSelected(label.id, query)}
          onClick={() => onSelect(blockPatch(label.id, query))}
          sx={{ minHeight: 96 }}
        />
      ))}
      <LabelBlock
        label={null}
        count={counts.get(UNLABELED) ?? 0}
        selected={isBlockSelected(UNLABELED, query)}
        onClick={() => onSelect(blockPatch(UNLABELED, query))}
        sx={{ minHeight: 96 }}
      />
    </Box>
  );
}
