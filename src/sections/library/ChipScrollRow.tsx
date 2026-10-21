import Box from '@mui/material/Box';
import { lazy, Suspense, useRef, type ReactNode } from 'react';
import { useLayout } from 'src/sections/shell/use-layout';

type Props = { label: string; children: ReactNode };

// 넓은·중간 화면의 스크롤 단추는 첫 로딩 예산(`initialJsGzipMax`)을 아끼려고 나중에 받는다. 받지 못하면 단추 없이 둔다.
// 칩 줄 자체는 늘 여기서 그려, 단추를 받아도 칩이 다시 그려지지(포커스를 잃지) 않는다.
const ChipScrollButton = lazy(() =>
  import('src/sections/library/ChipScrollButton').then(
    (m) => ({ default: m.ChipScrollButton }),
    () => ({ default: () => null }),
  ),
);

/** 가로로 넘기는 칩 줄. 넓은·중간 화면은 넘칠 때만 양끝에 스크롤 단추가 붙는다. 휴대폰은 손가락으로 넘긴다. */
export function ChipScrollRow({ label, children }: Props) {
  const rowRef = useRef<HTMLDivElement>(null);
  const compact = useLayout() === 'compact';
  const button = (side: -1 | 1) =>
    !compact && (
      <Suspense fallback={null}>
        <ChipScrollButton side={side} rowRef={rowRef} label={label} watch={children} />
      </Suspense>
    );
  return (
    <Box sx={{ display: 'flex', minWidth: 0 }}>
      {button(-1)}
      <Box
        ref={rowRef}
        role="group"
        aria-label={label}
        sx={{
          display: 'flex',
          flex: 1,
          minWidth: 0,
          gap: 0.5,
          overflowX: 'auto',
          px: 2,
          scrollbarWidth: 'none',
        }}
      >
        {children}
      </Box>
      {button(1)}
    </Box>
  );
}
