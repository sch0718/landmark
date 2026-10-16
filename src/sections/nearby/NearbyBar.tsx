import Box from '@mui/material/Box';
import dayjs from 'dayjs';
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';
import { XIcon } from 'src/components/icons';
import { ACCURACY_WARN_M, formatDistanceM, NEARBY_RADII, radiusLabel } from 'src/domain/nearby';
import { ChipButton } from 'src/sections/library/ChipButton';
import {
  locateAtom,
  myLocationAtom,
  nearbyAtom,
  nearbyOffAtom,
  type MyLocationState,
} from 'src/stores/my-location';

/** 위치를 이만큼(ms) 찾지 못하면 실내 안내를 덧붙인다. */
export const SLOW_LOCATE_MS = 5000;

const BUTTON_SX = {
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
  '&:disabled': { cursor: 'default', opacity: 0.45 },
  '&:focus-visible': { outlineOffset: -2 },
} as const;

/** 찾는 중 상태가 5초 이어졌는가. 찾기마다 상태 객체가 새로 생기므로 그 객체를 기준으로 잰다. */
function useSlowLocating(state: MyLocationState): boolean {
  const [slowFor, setSlowFor] = useState<MyLocationState | null>(null);
  useEffect(() => {
    if (!state.locating) return;
    const timer = setTimeout(() => setSlowFor(state), SLOW_LOCATE_MS);
    return () => clearTimeout(timer);
  }, [state]);
  return state.locating && slowFor === state;
}

/**
 * 근처 줄(스펙 §4.2). 근처 모드일 때만 필터 줄 아래에 붙는다.
 * 1줄: 상태 문장(`role="status"`) · `직선거리` · `다시 찾기`/`다시 시도` · `가까운 순 끄기`. 2줄: 반경 칩.
 * `count`는 지금 목록에 보이는 장소 수(반경 안).
 */
export function NearbyBar({ count }: { count: number }) {
  const nearby = useAtomValue(nearbyAtom);
  const setNearby = useSetAtom(nearbyAtom);
  const turnOff = useSetAtom(nearbyOffAtom);
  const locate = useSetAtom(locateAtom);
  const state = useAtomValue(myLocationAtom);
  const slow = useSlowLocating(state);
  if (!nearby.on) return null;

  const { fix, locating, error } = state;
  // 다시 찾는 중에는 이전 오류가 남아 있으므로 찾는 중을 먼저 본다.
  const failed = !locating && error !== null;
  const found = !locating && error === null && fix !== null ? fix : null;
  let sentence: string;
  if (failed) {
    sentence = error.userMessage;
  } else if (found !== null) {
    const at = dayjs(found.at).format('HH:mm');
    sentence =
      nearby.radiusM === null
        ? `내 위치에서 가까운 순 · ${count}곳 · ${at} 기준`
        : `내 위치에서 ${radiusLabel(nearby.radiusM)} 안 · ${count}곳 · ${at} 기준`;
  } else {
    sentence = slow ? '내 위치를 찾는 중… 실내에서는 오래 걸릴 수 있어요' : '내 위치를 찾는 중…';
  }
  const warning =
    found !== null && found.accuracyM > ACCURACY_WARN_M
      ? `위치 오차가 커요(약 ${formatDistanceM(found.accuracyM)})`
      : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', pb: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 2, pr: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0, py: 0.5, fontSize: 13 }}>
          <Box role="status" sx={{ color: failed ? 'error.main' : 'text.primary' }}>
            <Box component="span" sx={{ display: 'block' }}>
              {sentence}
            </Box>
            {warning !== null && (
              <Box component="span" sx={{ display: 'block', color: 'text.secondary' }}>
                {warning}
              </Box>
            )}
          </Box>
        </Box>
        {fix !== null && (
          <Box component="span" sx={{ flex: 'none', fontSize: 12, color: 'text.secondary' }}>
            직선거리
          </Box>
        )}
        <Box
          component="button"
          type="button"
          disabled={locating}
          onClick={() => void locate()}
          sx={{ ...BUTTON_SX, px: 1, fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}
        >
          {failed ? '다시 시도' : '다시 찾기'}
        </Box>
        <Box
          component="button"
          type="button"
          aria-label="가까운 순 끄기"
          title="가까운 순 끄기"
          onClick={() => turnOff()}
          sx={BUTTON_SX}
        >
          <XIcon aria-hidden="true" width={18} height={18} />
        </Box>
      </Box>
      <Box
        role="group"
        aria-label="반경"
        sx={{ display: 'flex', gap: 0.5, overflowX: 'auto', px: 2, scrollbarWidth: 'none' }}
      >
        {NEARBY_RADII.map((radius) => (
          <ChipButton
            key={radiusLabel(radius)}
            selected={radius === nearby.radiusM}
            onClick={() => setNearby((prev) => ({ ...prev, radiusM: radius }))}
          >
            {radiusLabel(radius)}
          </ChipButton>
        ))}
      </Box>
    </Box>
  );
}
