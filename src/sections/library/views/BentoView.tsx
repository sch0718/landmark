import Box from '@mui/material/Box';
import {
  LabelBlock,
  UNLABELED,
  blockPatch,
  isBlockSelected,
  type OverviewProps,
} from 'src/sections/library/views/overview';

/** 개수가 가장 많은 라벨(0곳뿐이면 없음). 같으면 앞선 라벨. */
function biggestLabelId({ labels, counts }: OverviewProps): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const label of labels) {
    const count = counts.get(label.id) ?? 0;
    if (count > bestCount) {
      best = label.id;
      bestCount = count;
    }
  }
  return best;
}

/** 벤토 보기: 라벨 블록. 개수 1위 라벨이 2행을 차지하고 나머지는 1행, 마지막이 `미분류`. */
export function BentoView(props: OverviewProps) {
  const { labels, counts, query, onSelect } = props;
  const biggest = biggestLabelId(props);
  return (
    <Box
      role="group"
      aria-label="라벨 개요"
      sx={{
        display: 'grid',
        gridTemplateColumns: '1.2fr 1fr',
        gridAutoRows: '78px',
        gridAutoFlow: 'dense',
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
          sx={label.id === biggest ? { gridRow: 'span 2' } : undefined}
        />
      ))}
      <LabelBlock
        label={null}
        count={counts.get(UNLABELED) ?? 0}
        selected={isBlockSelected(UNLABELED, query)}
        onClick={() => onSelect(blockPatch(UNLABELED, query))}
      />
    </Box>
  );
}
