import Box from '@mui/material/Box';
import { LabelGlyph } from 'src/components/icons';
import { LABEL_ICONS, type LabelColor, type LabelIcon } from 'src/schema/library';
import { labelColors } from 'src/sections/library/label-style';
import { FOCUS_RING } from 'src/theme/focus-ring';

/** 스크린리더용 이름. `Record`라서 허용 목록에 아이콘이 늘면 여기서 컴파일 오류가 난다. */
export const ICON_NAMES: Record<LabelIcon, string> = {
  utensils: '식사',
  soup: '국물',
  coffee: '커피',
  croissant: '빵',
  beer: '맥주',
  wine: '와인',
  'ice-cream-cone': '디저트',
  fish: '해산물',
  beef: '고기',
  salad: '샐러드',
  waves: '바다',
  mountain: '산',
  trees: '숲',
  tent: '캠핑',
  camera: '사진',
  landmark: '명소',
  castle: '성',
  church: '교회',
  'shopping-bag': '쇼핑',
  store: '가게',
  bed: '잠자리',
  hotel: '호텔',
  car: '자동차',
  'train-front': '기차',
  footprints: '산책',
  baby: '아이',
  dog: '반려견',
  music: '음악',
  palette: '예술',
  star: '별',
  heart: '하트',
  flag: '깃발',
};

type Props = { value: LabelIcon; color: LabelColor; onChange(icon: LabelIcon): void };

/** 라벨 아이콘 32개(허용 목록). 하나만 고르는 라디오 묶음이다. */
export function IconPicker({ value, color, onChange }: Props) {
  const tone = labelColors(color);
  return (
    <Box
      role="radiogroup"
      aria-label="아이콘"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, 44px)',
        justifyContent: 'center',
      }}
    >
      {LABEL_ICONS.map((icon) => {
        const checked = icon === value;
        return (
          <Box
            key={icon}
            component="button"
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={ICON_NAMES[icon]}
            onClick={() => onChange(icon)}
            sx={{
              width: 44,
              height: 44,
              p: 0,
              border: 0,
              background: 'transparent',
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center',
              // 누르는 자리(44px)가 아니라 보이는 견본에 포커스 표시를 그린다.
              '&:focus-visible': { outline: 'none' },
              '&:focus-visible > span': FOCUS_RING,
            }}
          >
            <Box
              component="span"
              sx={{
                display: 'grid',
                placeItems: 'center',
                width: 36,
                height: 36,
                borderRadius: 'var(--tm-radius-md)',
                bgcolor: checked ? tone.fill : 'transparent',
                color: checked ? tone.text : 'var(--tm-text-secondary)',
                border: '1px solid',
                borderColor: checked ? tone.marker : 'transparent',
                '& svg': { width: 20, height: 20 },
              }}
            >
              <LabelGlyph name={icon} />
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
