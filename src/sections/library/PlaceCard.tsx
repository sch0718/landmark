import Box from '@mui/material/Box';
import { LabelBadge } from 'src/sections/library/LabelBadge';
import { ITEM_BUTTON_SX, type PlaceItemProps } from 'src/sections/library/PlaceRow';
import { SelectMark } from 'src/sections/library/SelectMark';
import { usePlaceGestures } from 'src/sections/library/use-place-gestures';

/** 줄 수를 CSS로만 자른다. 글자 수로 자르면 이모지(서로게이트 쌍)가 깨질 수 있다. */
const clamp = (lines: number) =>
  ({
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: lines,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    // 공백 없는 긴 글자도 카드 폭에서 줄바꿈한다.
    overflowWrap: 'anywhere',
  }) as const;

/** 카드 보기: 이름 바로 아래 메모(3줄, 말줄임), 그 아래 지역과 라벨 칩. */
export function PlaceCard({
  place,
  region,
  labels,
  selecting,
  selected,
  onOpen,
  onToggle,
}: PlaceItemProps) {
  const gestures = usePlaceGestures({ id: place.id, selecting, onOpen, onToggle });
  const memo = place.memo.value.trim();
  return (
    <Box
      component="button"
      type="button"
      aria-pressed={selecting ? selected : undefined}
      {...gestures}
      sx={{
        ...ITEM_BUTTON_SX,
        alignItems: 'flex-start',
        minHeight: 44,
        p: 1.5,
        borderRadius: 'var(--tm-radius-lg)',
        bgcolor: 'var(--tm-bg-surface)',
        boxShadow: 'var(--tm-shadow-1)',
        border: '1px solid',
        borderColor: selected ? 'var(--tm-accent-main)' : 'var(--tm-border)',
      }}
    >
      {selecting && <SelectMark checked={selected} />}
      <Box component="span" sx={{ display: 'block', flex: 1, minWidth: 0 }}>
        <Box component="span" data-part="name" sx={{ ...clamp(2), fontWeight: 800 }}>
          {place.name.value}
        </Box>
        {memo !== '' && (
          <Box
            component="span"
            data-part="memo"
            sx={{
              ...clamp(3),
              mt: 0.5,
              // 메모가 이 카드의 핵심이라 이름 바로 아래에 본문 크기·기본 글자색으로 크게 보인다(스펙 §5.2).
              fontSize: 16,
              color: 'var(--tm-text-primary)',
              // 메모의 줄바꿈은 살린다.
              whiteSpace: 'pre-line',
            }}
          >
            {memo}
          </Box>
        )}
        <Box
          component="span"
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 0.5,
            mt: 1,
            minWidth: 0,
          }}
        >
          <Box
            component="span"
            data-part="region"
            sx={{ fontSize: 12, color: 'var(--tm-text-muted)', overflowWrap: 'anywhere' }}
          >
            {region}
          </Box>
          {labels.map((label) => (
            <LabelBadge key={label.id} label={label} />
          ))}
        </Box>
      </Box>
    </Box>
  );
}
