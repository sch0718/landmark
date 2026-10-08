import Box from '@mui/material/Box';
import { regionOf } from 'src/domain/library/region';
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

/** 카드 보기: 이름 아래 메모 3줄(말줄임)과 라벨 칩. */
export function PlaceCard({
  place,
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
        <Box
          component="span"
          sx={{
            display: 'block',
            mt: 0.25,
            fontSize: 12,
            color: 'var(--tm-text-muted)',
            overflowWrap: 'anywhere',
          }}
        >
          {regionOf(place.address)}
        </Box>
        {memo !== '' && (
          <Box
            component="span"
            data-part="memo"
            sx={{
              ...clamp(3),
              mt: 0.75,
              fontSize: 14,
              color: 'var(--tm-text-secondary)',
              // 메모의 줄바꿈은 살린다.
              whiteSpace: 'pre-line',
            }}
          >
            {memo}
          </Box>
        )}
        {labels.length > 0 && (
          <Box
            component="span"
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1, minWidth: 0 }}
          >
            {labels.map((label) => (
              <LabelBadge key={label.id} label={label} />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
