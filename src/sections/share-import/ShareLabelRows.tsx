import Box from '@mui/material/Box';
import type { ShareLabelPlan } from 'src/domain/library/import-share';
import { ColorBadge } from 'src/sections/library/LabelBadge';

/** 가져오면 붙을 받은 라벨 한 줄씩: 색 칩·이름, 오른쪽에 `내 라벨에 합침` 또는 `새로 만듦`. */
export function ShareLabelRows({ labels }: { labels: readonly ShareLabelPlan[] }) {
  return (
    <Box component="ul" aria-label="받은 라벨" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {labels.map((label) => (
        <Box
          component="li"
          key={label.shareLabelId}
          sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 32 }}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <ColorBadge color={label.color} name={label.name} />
          </Box>
          <Box
            component="span"
            sx={{ flex: 'none', fontSize: 12, color: 'var(--tm-text-secondary)' }}
          >
            {label.reuse ? '내 라벨에 합침' : '새로 만듦'}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
