import Box from '@mui/material/Box';
import dayjs from 'dayjs';
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { XIcon } from 'src/components/icons';
import {
  ACCURACY_WARN_M,
  formatDistanceM,
  NEARBY_RADII,
  radiusLabel,
  type NearbyRadius,
} from 'src/domain/nearby';
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

/** 근처 줄 바깥에서 부르는 일. */
export type NearbyBarHandle = {
  /** 반경 칩 하나로 포커스를 옮긴다(`반경 넓히기` 단추가 빈 상태와 함께 사라질 때). */
  focusRadius(radius: NearbyRadius): void;
};

type Props = {
  /** 지금 목록에 보이는 장소 수(반경 안). */
  count: number;
  /** 필터 결과 중 반경 밖이라 숨은 장소 수(스펙 §13 결정 11). 0이거나 반경이 `전체`면 문장에 넣지 않는다. */
  hidden: number;
  /** `가까운 순 끄기`(×)로 근처 모드를 끈 직후. × 단추가 함께 사라지므로 부른 쪽이 포커스를 옮긴다. */
  onTurnedOff?(): void;
  ref?: Ref<NearbyBarHandle>;
};

/**
 * 근처 줄(스펙 §4.2). 근처 모드일 때만 필터 줄 아래에 붙는다.
 * 1줄: 상태 문장(`role="status"`) · `직선거리` · `다시 찾기`/`다시 시도` · `가까운 순 끄기`. 2줄: 반경 칩.
 */
export function NearbyBar({ count, hidden, onTurnedOff, ref }: Props) {
  const nearby = useAtomValue(nearbyAtom);
  const setNearby = useSetAtom(nearbyAtom);
  const turnOff = useSetAtom(nearbyOffAtom);
  const locate = useSetAtom(locateAtom);
  const state = useAtomValue(myLocationAtom);
  const slow = useSlowLocating(state);
  const radiusGroup = useRef<HTMLDivElement>(null);
  useImperativeHandle(
    ref,
    () => ({
      focusRadius(radius) {
        // 칩은 `NEARBY_RADII` 순서로 늘 모두 그려진다.
        const chips = radiusGroup.current?.querySelectorAll('button');
        chips?.[NEARBY_RADII.indexOf(radius)]?.focus();
      },
    }),
    [],
  );
  if (!nearby.on) return null;

  const { fix, locating, error } = state;
  // 다시 찾는 중에는 이전 오류가 남아 있으므로 찾는 중을 먼저 본다.
  const failed = !locating && error !== null;
  // 목록의 순서·거리가 기대는 위치. 다시 찾다 실패해도 지난 위치 기준 목록이 남으므로(스펙 §4.2) 그 기준을 함께 보인다.
  const basis = !locating && fix !== null ? fix : null;
  const basisSentence = (() => {
    if (basis === null) return null;
    const at = dayjs(basis.at).format('HH:mm');
    if (nearby.radiusM === null) return `내 위치에서 가까운 순 · ${count}곳 · ${at} 기준`;
    const radius = radiusLabel(nearby.radiusM);
    const hiddenNote = hidden > 0 ? ` · ${radius} 밖 ${hidden}곳은 숨김` : '';
    return `내 위치에서 ${radius} 안 · ${count}곳 · ${at} 기준${hiddenNote}`;
  })();
  let sentence: string;
  if (failed) {
    sentence = error.userMessage;
  } else if (basisSentence !== null) {
    sentence = basisSentence;
  } else {
    sentence = slow ? '내 위치를 찾는 중… 실내에서는 오래 걸릴 수 있어요' : '내 위치를 찾는 중…';
  }
  // 실패 뒤의 기준 문장은 오류 아래 둘째 줄로 보인다.
  const staleBasis = failed ? basisSentence : null;
  const warning =
    basis !== null && basis.accuracyM > ACCURACY_WARN_M
      ? `위치 오차가 커요(약 ${formatDistanceM(basis.accuracyM)})`
      : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', pb: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 2, pr: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0, py: 0.5, fontSize: 13 }}>
          <Box role="status" sx={{ color: failed ? 'error.main' : 'text.primary' }}>
            <Box component="span" sx={{ display: 'block' }}>
              {sentence}
            </Box>
            {staleBasis !== null && (
              <Box component="span" sx={{ display: 'block', color: 'text.secondary' }}>
                {staleBasis}
              </Box>
            )}
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
          onClick={() => {
            turnOff();
            onTurnedOff?.();
          }}
          sx={BUTTON_SX}
        >
          <XIcon aria-hidden="true" width={18} height={18} />
        </Box>
      </Box>
      <Box
        ref={radiusGroup}
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
