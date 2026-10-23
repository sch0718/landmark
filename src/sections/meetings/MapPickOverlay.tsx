import Box from '@mui/material/Box';
import Button from '@mui/material/Button';

type Props = {
  center: [number, number] | null;
  onPick(center: [number, number]): void;
  onCancel(): void;
};

/** 장소 추가 흐름과 별개인 약속 출발지 조준점. 지도 조작은 막지 않는다. */
export function MapPickOverlay({ center, onPick, onCancel }: Props) {
  const valid =
    center !== null &&
    Number.isFinite(center[0]) &&
    Number.isFinite(center[1]) &&
    center[0] >= 124 &&
    center[0] <= 132 &&
    center[1] >= 33 &&
    center[1] <= 39;
  return (
    <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
      <Box
        role="status"
        sx={{
          position: 'absolute',
          top: 8,
          left: 8,
          right: 64,
          p: 1,
          bgcolor: 'var(--tm-bg-surface)',
          borderRadius: 1,
          textAlign: 'center',
        }}
      >
        지도를 움직여 위치를 맞추세요
      </Box>
      <Box
        data-testid="meeting-crosshair"
        aria-hidden="true"
        sx={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          color: 'var(--tm-accent-main)',
          fontSize: 36,
          textShadow: '0 1px 2px #fff',
        }}
      >
        ＋
      </Box>
      <Box
        sx={{
          position: 'absolute',
          bottom: 12,
          left: 0,
          right: 0,
          display: 'flex',
          gap: 1,
          justifyContent: 'center',
          pointerEvents: 'auto',
        }}
      >
        <Button
          onClick={onCancel}
          variant="outlined"
          sx={{ minHeight: 44, bgcolor: 'var(--tm-bg-surface)' }}
        >
          취소
        </Button>
        <Button
          disabled={!valid}
          onClick={() => {
            if (valid && center !== null) onPick(center);
          }}
          variant="contained"
          sx={{ minHeight: 44 }}
        >
          여기로 정하기
        </Button>
      </Box>
    </Box>
  );
}
