import Box from '@mui/material/Box';
import { regionOf } from 'src/domain/library/region';
import type { Label, Place } from 'src/schema/library';
import { labelColors } from 'src/sections/library/label-style';
import { SelectMark } from 'src/sections/library/SelectMark';
import { usePlaceGestures } from 'src/sections/library/use-place-gestures';

export type PlaceItemProps = {
  place: Place;
  /** 살아 있는 라벨. 첫 번째가 대표 라벨. */
  labels: Label[];
  /** 선택된 장소가 하나라도 있는가. */
  selecting: boolean;
  selected: boolean;
  onOpen(id: string): void;
  onToggle(id: string): void;
};

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
  '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: -2 },
} as const;

/** 목록 보기의 한 줄: 이름 · 지역 · 대표 라벨 점. 높이는 터치 대상 기준 56px. */
export function PlaceRow({ place, labels, selecting, selected, onOpen, onToggle }: PlaceItemProps) {
  const gestures = usePlaceGestures({ id: place.id, selecting, onOpen, onToggle });
  const first = labels[0];
  return (
    <Box
      component="button"
      type="button"
      aria-pressed={selecting ? selected : undefined}
      {...gestures}
      sx={{
        ...ITEM_BUTTON_SX,
        minHeight: 56,
        px: 2,
        py: 1,
        bgcolor: selected ? 'var(--tm-bg-raised)' : 'transparent',
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
        {regionOf(place.address)}
      </Box>
      <Box
        component="span"
        aria-hidden="true"
        title={first?.name.value}
        sx={{
          flex: 'none',
          width: 10,
          height: 10,
          borderRadius: '50%',
          bgcolor: first === undefined ? 'transparent' : labelColors(first.color.value).marker,
          border: first === undefined ? '1px dashed var(--tm-border)' : 0,
        }}
      />
    </Box>
  );
}
