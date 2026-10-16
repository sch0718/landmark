import Box from '@mui/material/Box';
import { visuallyHidden } from '@mui/utils';
import { CheckIcon } from 'src/components/icons';
import { isVisited } from 'src/domain/library/visit';
import { formatDistanceM } from 'src/domain/nearby';
import type { Label, Place } from 'src/schema/library';
import { labelColors } from 'src/sections/library/label-style';
import { SelectMark } from 'src/sections/library/SelectMark';
import { usePlaceGestures } from 'src/sections/library/use-place-gestures';

export type PlaceItemProps = {
  place: Place;
  /** 표시할 지역(주소가 없으면 가까운 장소에서 빌린 지역). */
  region: string;
  /** 살아 있는 라벨. 첫 번째가 대표 라벨. */
  labels: Label[];
  /** 선택된 장소가 하나라도 있는가. */
  selecting: boolean;
  selected: boolean;
  /** 지금 상세가 열려 있는 장소인가. */
  current?: boolean;
  onOpen(id: string): void;
  onToggle(id: string): void;
  /** 내 위치에서의 직선거리(m). 근처 모드일 때만 있고, 있으면 지역 자리에 대신 보인다. */
  distanceM?: number;
};

/** 지역 자리에 들어가는 글자: 거리가 있으면 거리(화면 읽기에는 `내 위치에서 570m`), 없으면 지역. */
export function RegionOrDistance({ region, distanceM }: { region: string; distanceM?: number }) {
  if (distanceM === undefined) return region;
  return (
    <span>
      {/* 띄어쓰기는 숨은 글자 밖에 둔다(숨은 글자 끝의 공백은 접근 이름에서 잘린다). 줄 맨 앞 공백이라 눈에는 안 보인다. */}
      <Box component="span" sx={visuallyHidden}>
        내 위치에서
      </Box>{' '}
      {formatDistanceM(distanceM)}
    </span>
  );
}

/** 보기가 선택할 수 있는 장소 칸이 공유하는 버튼 바탕. */
export const ITEM_BUTTON_SX = {
  display: 'flex',
  alignItems: 'center',
  gap: 1.25,
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  m: 0,
  border: 0,
  background: 'transparent',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  userSelect: 'none',
  WebkitTouchCallout: 'none',
  touchAction: 'manipulation',
  '&:focus-visible': { outlineOffset: -2 },
} as const;

/** 행에 보이는 라벨 칩의 최대 개수. 넘치면 `+N`으로 줄인다. */
const MAX_CHIPS = 2;

/** 목록 보기의 한 줄: 이름 · 라벨 칩(최대 2개 + `+N`) · 지역. 높이는 터치 대상 기준 56px. */
export function PlaceRow({
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
  const chips = labels.slice(0, MAX_CHIPS);
  const more = labels.length - chips.length;
  return (
    <Box
      component="button"
      type="button"
      aria-pressed={selecting ? selected : undefined}
      aria-current={current ? 'true' : undefined}
      {...gestures}
      sx={{
        ...ITEM_BUTTON_SX,
        minHeight: 56,
        px: 2,
        py: 1,
        bgcolor: selected || current ? 'var(--tm-bg-raised)' : 'transparent',
        boxShadow: current ? 'inset 3px 0 0 var(--tm-accent-main)' : 'none',
        borderBottom: '1px solid var(--tm-border)',
      }}
    >
      {selecting && <SelectMark checked={selected} />}
      <Box
        component="span"
        sx={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontWeight: 700,
        }}
      >
        {place.name.value}
      </Box>
      {isVisited(place) && (
        <>
          {/* 색만으로 알리지 않는다: 체크는 장식이고 같은 뜻을 숨은 글자가 읽어 준다. */}
          <CheckIcon
            aria-hidden="true"
            width={16}
            height={16}
            style={{ flex: 'none', color: 'var(--tm-accent-text)' }}
          />
          <Box component="span" sx={visuallyHidden}>
            다녀옴
          </Box>
        </>
      )}
      {chips.length > 0 && (
        <Box
          component="span"
          sx={{
            flex: '0 1 auto',
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            minWidth: 0,
            maxWidth: '45%',
            overflow: 'hidden',
          }}
        >
          {chips.map((label) => {
            const color = labelColors(label.color.value);
            return (
              <Box
                key={label.id}
                component="span"
                sx={{
                  flex: '0 1 auto',
                  minWidth: 0,
                  px: 0.75,
                  borderRadius: 999,
                  bgcolor: color.fill,
                  color: color.text,
                  fontSize: 11,
                  fontWeight: 700,
                  lineHeight: 1.6,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {label.name.value}
              </Box>
            );
          })}
          {more > 0 && (
            <Box
              component="span"
              sx={{ flex: 'none', fontSize: 11, color: 'var(--tm-text-secondary)' }}
            >
              +{more}
            </Box>
          )}
        </Box>
      )}
      <Box
        component="span"
        sx={{
          flex: 'none',
          maxWidth: '35%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 13,
          color: 'var(--tm-text-secondary)',
        }}
      >
        <RegionOrDistance region={region} distanceM={distanceM} />
      </Box>
    </Box>
  );
}
