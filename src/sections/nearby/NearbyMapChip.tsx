import Box from '@mui/material/Box';
import { useAtomValue, useSetAtom } from 'jotai';
import { useRef } from 'react';
import { XIcon } from 'src/components/icons';
import { radiusLabel } from 'src/domain/nearby';
import { myLocationAtom, nearbyAtom, nearbyOffAtom } from 'src/stores/my-location';

const FOCUSABLE = 'button:not(:disabled), a[href]';

/** `el` 뒤에 오는 형제들 가운데 처음 만나는 누를 수 있는 단추·링크. */
function nextFocusable(el: HTMLElement): HTMLElement | null {
  for (
    let sibling = el.nextElementSibling;
    sibling !== null;
    sibling = sibling.nextElementSibling
  ) {
    const target = sibling.matches(FOCUSABLE) ? sibling : sibling.querySelector(FOCUSABLE);
    if (target instanceof HTMLElement) return target;
  }
  return null;
}

/**
 * 좁은 화면 지도의 근처 칩(스펙 §4.3). 근처 모드이고 위치가 있을 때(`useNearby`의 `active`)만
 * 칩 줄 맨 앞에 `내 근처 3km`(전체면 `내 근처`)와 `가까운 순 끄기`(×)를 둔다. 지도에 장소가 왜 적게 보이는지 알린다.
 * ×를 누르면 칩이 사라지므로 포커스를 같은 칩 줄의 다음 칩으로 옮긴다.
 */
export function NearbyMapChip() {
  const { on, radiusM } = useAtomValue(nearbyAtom);
  const { fix } = useAtomValue(myLocationAtom);
  const turnOff = useSetAtom(nearbyOffAtom);
  const wrapper = useRef<HTMLDivElement>(null);
  if (!on || fix === null) return null;

  return (
    <Box ref={wrapper} sx={{ flex: 'none', display: 'flex', alignItems: 'center' }}>
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
        onClick={() => {
          const next = wrapper.current === null ? null : nextFocusable(wrapper.current);
          turnOff();
          next?.focus();
        }}
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
