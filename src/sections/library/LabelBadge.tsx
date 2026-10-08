import Box from '@mui/material/Box';
import { LabelGlyph } from 'src/components/icons';
import type { Label } from 'src/schema/library';
import { labelColors } from 'src/sections/library/label-style';

/** 카드에 붙는 작은 라벨 칩. 이름이 길면 칩 안에서 말줄임한다. */
export function LabelBadge({ label }: { label: Label }) {
  const color = labelColors(label.color.value);
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        maxWidth: '100%',
        minWidth: 0,
        px: 1,
        py: 0.25,
        borderRadius: 999,
        bgcolor: color.fill,
        color: color.text,
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1.5,
        '& svg': { flex: 'none', width: 12, height: 12 },
      }}
    >
      <LabelGlyph name={label.icon.value} size={12} />
      <Box
        component="span"
        sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {label.name.value}
      </Box>
    </Box>
  );
}
