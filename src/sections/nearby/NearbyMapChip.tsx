import Box from '@mui/material/Box';
import { useAtomValue, useSetAtom } from 'jotai';
import { XIcon } from 'src/components/icons';
import { radiusLabel } from 'src/domain/nearby';
import { myLocationAtom, nearbyAtom, nearbyOffAtom } from 'src/stores/my-location';

/**
 * 좁은 화면 지도의 근처 칩(스펙 §4.3). 근처 모드이고 위치가 있을 때(`useNearby`의 `active`)만
 * 칩 줄 맨 앞에 `내 근처 3km`(전체면 `내 근처`)와 `가까운 순 끄기`(×)를 둔다. 지도에 장소가 왜 적게 보이는지 알린다.
 */
export function NearbyMapChip() {
  const { on, radiusM } = useAtomValue(nearbyAtom);
  const { fix } = useAtomValue(myLocationAtom);
  const turnOff = useSetAtom(nearbyOffAtom);
  if (!on || fix === null) return null;

  return (
    <Box sx={{ flex: 'none', display: 'flex', alignItems: 'center' }}>
      {/* 켜진 칩(`ChipButton` 선택 모양)과 같이 그리되, 누르는 것은 옆의 ×뿐이다. */}
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          height: 32,
          px: 1.5,
          boxSizing: 'border-box',
          borderRadius: 999,
          border: '1px solid var(--tm-accent-main)',
          bgcolor: 'var(--tm-accent-main)',
          color: 'var(--tm-accent-contrast)',
          fontSize: 14,
          fontWeight: 700,
          whiteSpace: 'nowrap',
        }}
      >
        {radiusM === null ? '내 근처' : `내 근처 ${radiusLabel(radiusM)}`}
      </Box>
      <Box
        component="button"
        type="button"
        aria-label="가까운 순 끄기"
        title="가까운 순 끄기"
        onClick={() => turnOff()}
        sx={{
          flex: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 44,
          minHeight: 44,
          border: 0,
          borderRadius: 'var(--tm-radius-md)',
          background: 'transparent',
          font: 'inherit',
          color: 'var(--tm-text-secondary)',
          cursor: 'pointer',
          '&:focus-visible': { outlineOffset: -2 },
        }}
      >
        <XIcon aria-hidden="true" width={18} height={18} />
      </Box>
    </Box>
  );
}
