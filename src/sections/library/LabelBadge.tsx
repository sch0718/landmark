import Box from '@mui/material/Box';
import { LabelGlyph } from 'src/components/icons';
import { TruncatedText } from 'src/components/TruncatedText';
import type { Label, LabelColor, LabelIcon } from 'src/schema/library';
import { labelColors } from 'src/sections/library/label-style';

/** 카드에 붙는 작은 라벨 칩. 이름이 길면 칩 안에서 말줄임하고, 잘렸으면 전체 이름 툴팁을 보인다. */
export function LabelBadge({ label, touch }: { label: Label; touch?: boolean }) {
  return (
    <ColorBadge
      color={label.color.value}
      icon={label.icon.value}
      name={label.name.value}
      touch={touch}
    />
  );
}

/** 라벨 칩의 꼴. 받은 공유 파일의 라벨처럼 아이콘이 없으면 이름만 보인다. */
export function ColorBadge({
  color,
  icon,
  name,
  touch,
}: {
  color: LabelColor;
  icon?: LabelIcon;
  name: string;
  /** `false`면 길게 누르기로 툴팁을 열지 않는다(카드 안: 길게 누르기 = 선택). */
  touch?: boolean;
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
      <TruncatedText touch={touch} sx={{ minWidth: 0 }}>
        {name}
      </TruncatedText>
    </Box>
  );
}
