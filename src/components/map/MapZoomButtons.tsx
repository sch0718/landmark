import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import { MinusIcon, PlusIcon } from 'src/components/icons';
import type { MapAdapter } from './MapAdapter';

/** 한 번 누를 때 바뀌는 줌 단계. 네이버 SDK 막대의 ＋/−와 같다. */
const ZOOM_STEP = 1;

function zoomBy(adapter: MapAdapter, delta: number) {
  const camera = adapter.getCamera();
  // 줌 범위는 SDK가 지킨다(범위 밖 값은 끝 값으로 맞춘다).
  if (camera) adapter.setCamera({ center: camera.center, zoom: camera.zoom + delta });
}

const buttonSx = {
  width: 44,
  height: 44,
  borderRadius: 0,
  color: 'var(--tm-text-primary)',
  // 테마의 포커스 표시는 바깥에 그려지는데 둘을 감싼 칸이 넘침을 자르므로 안쪽으로 그린다.
  '&.Mui-focusVisible': { outlineOffset: -2 },
} as const;

/**
 * 터치 전용 기기의 확대·축소 버튼. 두 손가락을 쓰지 못해도 한 손가락으로 축소할 수 있게
 * 남긴다(WCAG 2.5.1). SDK 막대 대신 44px 버튼 둘을 지도 오른쪽 위에 둔다.
 */
export function MapZoomButtons({ adapter }: { adapter: MapAdapter }) {
  return (
    <Box
      role="group"
      aria-label="지도 확대·축소"
      sx={{
        position: 'absolute',
        top: 8,
        right: 8,
        // 지도 SDK의 레이어(`MapView`가 쌓임 맥락을 가둔다) 위에 둔다.
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'var(--tm-bg-surface)',
        border: '1px solid var(--tm-border-strong, var(--tm-border))',
        borderRadius: 'var(--tm-radius-md)',
        boxShadow: 'var(--tm-shadow-1)',
        overflow: 'hidden',
      }}
    >
      <IconButton aria-label="지도 확대" onClick={() => zoomBy(adapter, ZOOM_STEP)} sx={buttonSx}>
        <PlusIcon aria-hidden="true" width={20} height={20} />
      </IconButton>
      <Box aria-hidden="true" sx={{ height: '1px', bgcolor: 'var(--tm-border)' }} />
      <IconButton aria-label="지도 축소" onClick={() => zoomBy(adapter, -ZOOM_STEP)} sx={buttonSx}>
        <MinusIcon aria-hidden="true" width={20} height={20} />
      </IconButton>
    </Box>
  );
}
