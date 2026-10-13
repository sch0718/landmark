import Box from '@mui/material/Box';
import { LabelGlyph } from 'src/components/icons';
import type { Label, LabelColor, LabelIcon } from 'src/schema/library';
import { labelColors } from 'src/sections/library/label-style';

/** 카드에 붙는 작은 라벨 칩. 이름이 길면 칩 안에서 말줄임한다. */
export function LabelBadge({ label }: { label: Label }) {
  return <ColorBadge color={label.color.value} icon={label.icon.value} name={label.name.value} />;
}

/** 라벨 칩의 꼴. 받은 공유 파일의 라벨처럼 아이콘이 없으면 이름만 보인다. */
export function ColorBadge({
  color,
  icon,
  name,
}: {
  color: LabelColor;
  icon?: LabelIcon;
  name: string;
}) {
  const tone = labelColors(color);
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
        bgcolor: tone.fill,
        color: tone.text,
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1.5,
        '& svg': { flex: 'none', width: 12, height: 12 },
      }}
    >
      {icon !== undefined && <LabelGlyph name={icon} size={12} />}
      <Box
        component="span"
        sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {name}
      </Box>
    </Box>
  );
}
