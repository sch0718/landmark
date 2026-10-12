import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useState } from 'react';
import { LabelGlyph } from 'src/components/icons';
import { useLayout } from 'src/sections/shell/use-layout';
import { formatDistance, formatDuration } from 'src/sections/trips/planner/format';
import { naverDirectionsUrl } from 'src/sections/trips/planner/naver-directions';
import type { PlannedLeg } from 'src/sections/trips/planner/use-day-plan';

const MODE_LABEL = { car: '자동차', walk: '도보' } as const;

/** 구간 상태 문구(스펙 §6). 받은 경로는 문구가 없다. */
const STATUS_TEXT: Record<PlannedLeg['status'], string | null> = {
  routed: null,
  estimated: '직선 추정',
  'no-route': '경로 없음 · 직선 추정',
  failed: '경로를 못 가져왔어요',
};

type Props = {
  leg: PlannedLeg;
  onMode(mode: 'car' | 'walk'): void;
  onRetry(): void;
};

/**
 * 장소 행 사이의 구간 행: 수단(눌러 바꾸기) · 시간 · 거리 · 상태.
 * 직선 50km를 넘는 구간은 도보를 고를 수 없다.
 */
export function LegRow({ leg, onMode, onRetry }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const status = STATUS_TEXT[leg.status];
  // 좁은 화면은 네이버 지도 앱 주소, 그 밖은 웹 길찾기. 주소를 못 만들면 링크를 숨긴다.
  const layout = useLayout();
  const directionsUrl = naverDirectionsUrl(
    {
      from: { name: leg.from.name.value, lng: leg.from.lng, lat: leg.from.lat },
      to: { name: leg.to.name.value, lng: leg.to.lng, lat: leg.to.lat },
      mode: leg.mode,
    },
    layout === 'compact' ? 'app' : 'web',
  );
  const choose = (mode: 'car' | 'walk') => {
    setAnchor(null);
    if (mode !== leg.mode) onMode(mode);
  };
  return (
    <Box
      component="li"
      aria-label={`${leg.from.name.value} → ${leg.to.name.value}`}
      sx={{
        listStyle: 'none',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 1,
        pl: 4.5,
        pr: 1,
        py: 0.25,
        fontSize: 13,
        color: 'var(--tm-text-secondary)',
        borderLeft: '2px dashed var(--tm-border)',
        ml: 2.25,
      }}
    >
      <Box
        component="button"
        type="button"
        aria-haspopup="menu"
        aria-expanded={anchor !== null ? 'true' : undefined}
        aria-label={`이동 수단 바꾸기, 지금 ${MODE_LABEL[leg.mode]}`}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          minHeight: 44,
          px: 1,
          ml: -1,
          border: 0,
          borderRadius: 'var(--tm-radius-md)',
          background: 'transparent',
          font: 'inherit',
          color: 'inherit',
          cursor: 'pointer',
          '&:hover': { bgcolor: 'var(--tm-bg-raised)' },
          '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: -2 },
        }}
      >
        <LabelGlyph name={leg.mode === 'car' ? 'car' : 'footprints'} size={16} />
        <span>{MODE_LABEL[leg.mode]}</span>
      </Box>
      <span>{`${formatDuration(leg.time.durationS)} · ${formatDistance(leg.time.distanceM)}`}</span>
      {status !== null && (
        <Box
          component="span"
          sx={{
            color: leg.status === 'failed' ? 'var(--tm-text-primary)' : 'var(--tm-text-muted)',
          }}
        >
          {status}
        </Box>
      )}
      {leg.status === 'failed' && (
        <Button size="small" onClick={onRetry} sx={{ minHeight: 44 }}>
          다시 시도
        </Button>
      )}
      {directionsUrl !== null && (
        <Box
          component="a"
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            minHeight: 44,
            px: 1,
            color: 'var(--tm-accent-main)',
            textDecoration: 'none',
            borderRadius: 'var(--tm-radius-md)',
            '&:hover': { textDecoration: 'underline' },
            '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: -2 },
          }}
        >
          네이버 지도로 길찾기
        </Box>
      )}
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        <MenuItem
          selected={leg.mode === 'car'}
          onClick={() => choose('car')}
          sx={{ minHeight: 44 }}
        >
          자동차
        </MenuItem>
        <MenuItem
          selected={leg.mode === 'walk'}
          disabled={!leg.walkAllowed}
          onClick={() => choose('walk')}
          sx={{ minHeight: 44 }}
        >
          도보
        </MenuItem>
      </Menu>
    </Box>
  );
}
