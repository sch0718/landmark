import Box from '@mui/material/Box';
import { CheckIcon } from 'src/components/icons';
import { TruncatedText } from 'src/components/TruncatedText';
import { formatVisitDate, reviewOf, visitedOnOf } from 'src/domain/library/visit';
import { LabelBadge } from 'src/sections/library/LabelBadge';
import {
  ITEM_BUTTON_SX,
  RegionOrDistance,
  type PlaceItemProps,
} from 'src/sections/library/PlaceRow';
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

/** 카드 보기: 이름 바로 아래 메모(3줄, 말줄임)와 한 줄 평(2줄), 그 아래 다녀옴 배지·지역(근처면 거리)·라벨 칩. */
export function PlaceCard({
  place,
  region,
  labels,
  selecting,
  selected,
  current = false,
  onOpen,
  onToggle,
  distanceM,
}: PlaceItemProps) {
  const gestures = usePlaceGestures({ id: place.id, selecting, onOpen, onToggle });
  const memo = place.memo.value.trim();
  const visitedOn = visitedOnOf(place);
  const review = reviewOf(place);
  return (
    <Box
      component="button"
      type="button"
      aria-pressed={selecting ? selected : undefined}
      aria-current={current ? 'true' : undefined}
      data-place-id={place.id}
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
        borderColor: selected || current ? 'var(--tm-accent-main)' : 'var(--tm-border)',
      }}
    >
      {selecting && <SelectMark checked={selected} />}
      <Box component="span" sx={{ display: 'block', flex: 1, minWidth: 0 }}>
        <TruncatedText lines={2} touch={false} data-part="name" sx={{ fontWeight: 800 }}>
          {place.name.value}
        </TruncatedText>
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
        {review !== '' && (
          <Box
            component="span"
            data-part="review"
            sx={{ ...clamp(2), mt: 0.5, fontSize: 14, color: 'text.secondary' }}
          >
            {`“${review}”`}
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
          {visitedOn !== null && (
            <Box
              component="span"
              data-part="visited"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.25,
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--tm-accent-text)',
              }}
            >
              <CheckIcon aria-hidden="true" width={12} height={12} style={{ flex: 'none' }} />
              {`다녀옴 ${formatVisitDate(visitedOn)}`}
            </Box>
          )}
          <Box
            component="span"
            data-part="region"
            sx={{ fontSize: 12, color: 'var(--tm-text-muted)', overflowWrap: 'anywhere' }}
          >
            <RegionOrDistance region={region} distanceM={distanceM} />
          </Box>
          {labels.map((label) => (
            <LabelBadge key={label.id} label={label} touch={false} />
          ))}
        </Box>
      </Box>
    </Box>
  );
}
