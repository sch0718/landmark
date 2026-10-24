import Box from '@mui/material/Box';
import type { HelpPage } from './help-content';
import { useResolvedTheme } from 'src/theme/use-theme';

/** 휴대폰 화면(768px 미만) 기준. 셸의 하단 탭 배치와 같다. */
const NARROW = '@media (max-width: 767.95px)';

/**
 * 문서와 앱이 같은 SVG 한 벌을 쓴다. 실제 밝기 모드는 시스템 설정까지 반영한다.
 * 좁은 화면에서는 그림(960×520) 중 오른쪽 휴대폰 화면(x 600–900, y 20–500)만 잘라 원래 크기로 보인다.
 * 왼쪽 단계 목록은 그림 아래 글에도 있으므로, 통째로 줄여 글자가 작아지는 것보다 낫다.
 */
export function HelpFigure({ page, compact = false }: { page: HelpPage; compact?: boolean }) {
  const { mode } = useResolvedTheme();
  return (
    <Box
      sx={{
        overflow: 'hidden',
        mx: 'auto',
        width: '100%',
        aspectRatio: '960 / 520',
        // 처음 안내(`compact`)는 아래 글과 단추가 한 화면에 보이도록 높이를 화면의 40% 안으로 줄인다.
        [NARROW]: {
          width: compact ? 'min(100%, 300px, 25vh)' : 'min(100%, 300px)',
          aspectRatio: '300 / 480',
        },
      }}
    >
      <Box
        component="img"
        src={`/help/img/${page.id}-${mode}.svg`}
        alt={`${page.title} 사용법: ${page.steps.map((step, index) => `${index + 1}. ${step.title.replace(/`/g, '')}`).join(' ')}`}
        width={960}
        height={520}
        sx={{
          display: 'block',
          width: '100%',
          height: 'auto',
          aspectRatio: '960 / 520',
          // 여백 백분율은 감싼 상자의 너비 기준이다: 600/300 = 200%, 20/300 ≈ 6.667%.
          [NARROW]: { width: '320%', maxWidth: 'none', ml: '-200%', mt: '-6.667%' },
        }}
      />
    </Box>
  );
}
