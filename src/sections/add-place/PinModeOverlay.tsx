import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useAtom } from 'jotai';
import { useEffect } from 'react';
import { MapPinIcon } from 'src/components/icons';
import { addFlowAtom } from 'src/stores/add-place';

/**
 * 핀 모드 오버레이(스펙 §2.4). 지도 위에 덮이며, 가운데 조준점이 고를 위치다(지도 중심 = 조준점).
 * 오버레이는 지도 조작을 막지 않고(`pointer-events: none`) 안내와 버튼만 누를 수 있다.
 * `여기에 추가`는 지금 지도 중심으로 입력 카드(`pin-card`)를 열고, `취소`·Esc는 흐름을 닫는다.
 * `center`가 아직 없으면(지도를 못 불러옴 등) `여기에 추가`를 막는다.
 */
export function PinModeOverlay({ center }: { center: [number, number] | null }) {
  const [flow, setFlow] = useAtom(addFlowAtom);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      if (target instanceof Element) {
        // 대화상자·시트가 열려 있으면 Esc는 그쪽 몫이다.
        if (target.closest('.MuiModal-root, [role="dialog"]')) return;
        // 입력칸(목록 검색 등)의 Esc는 그 칸의 몫이다(지우기·조합 취소).
        if (
          target.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
          )
        )
          return;
      }
      setFlow((current) => (current.step === 'pin' ? { step: 'closed' } : current));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setFlow]);

  if (flow.step !== 'pin') return null;
  const name = flow.name;
  const confirm = () => {
    if (center === null) return;
    setFlow({ step: 'pin-card', name, lng: center[0], lat: center[1] });
  };

  return (
    <Box sx={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none' }}>
      <Box
        role="status"
        sx={{
          position: 'absolute',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          maxWidth: 'calc(100% - 32px)',
          px: 2,
          py: 1,
          borderRadius: 'var(--tm-radius-xl)',
          bgcolor: 'var(--tm-bg-surface)',
          color: 'var(--tm-text-primary)',
          boxShadow: 'var(--tm-shadow-2)',
          fontSize: 14,
          fontWeight: 700,
          textAlign: 'center',
          pointerEvents: 'auto',
        }}
      >
        지도를 움직여 위치를 맞추세요
      </Box>
      {/* 조준점: 핀 끝이 지도 중심에 닿고, 그 자리에 작은 점을 둔다. */}
      <Box
        data-testid="pin-crosshair"
        aria-hidden="true"
        sx={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0 }}
      >
        <Box
          component={MapPinIcon}
          sx={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 36,
            height: 36,
            transform: 'translate(-50%, -100%)',
            color: 'var(--tm-accent-main)',
            filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35))',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            left: -3,
            top: -3,
            width: 6,
            height: 6,
            borderRadius: '50%',
            bgcolor: 'var(--tm-accent-main)',
            border: '1px solid var(--tm-bg-surface)',
          }}
        />
      </Box>
      <Box
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 16,
          display: 'flex',
          justifyContent: 'center',
          gap: 1,
          px: 2,
        }}
      >
        <Button
          variant="outlined"
          onClick={() => setFlow({ step: 'closed' })}
          sx={{
            minHeight: 44,
            pointerEvents: 'auto',
            bgcolor: 'var(--tm-bg-surface)',
            boxShadow: 'var(--tm-shadow-2)',
            '&:hover': { bgcolor: 'var(--tm-bg-raised)' },
          }}
        >
          취소
        </Button>
        <Button
          variant="contained"
          disabled={center === null}
          onClick={confirm}
          sx={{ minHeight: 44, pointerEvents: 'auto', boxShadow: 'var(--tm-shadow-2)' }}
        >
          여기에 추가
        </Button>
      </Box>
    </Box>
  );
}
