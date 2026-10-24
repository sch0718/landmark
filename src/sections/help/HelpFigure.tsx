import Box from '@mui/material/Box';
import type { HelpPage } from './help-content';
import { useResolvedTheme } from 'src/theme/use-theme';

/** 문서와 앱이 같은 SVG 한 벌을 쓴다. 실제 밝기 모드는 시스템 설정까지 반영한다. */
export function HelpFigure({ page }: { page: HelpPage }) {
  const { mode } = useResolvedTheme();
  return (
    <Box
      component="img"
      src={`/help/img/${page.id}-${mode}.svg`}
      alt={`${page.title} 사용법: ${page.steps.map((step, index) => `${index + 1}. ${step.title.replace(/`/g, '')}`).join(' ')}`}
      width={960}
      height={520}
      sx={{ display: 'block', width: '100%', height: 'auto', aspectRatio: '960 / 520' }}
    />
  );
}
