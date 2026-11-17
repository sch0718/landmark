import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useId, useState } from 'react';
import { BusIcon, CarIcon, FootprintsIcon } from 'src/components/icons';
import { isAbroadLeg } from 'src/lib/korea';
import { useLayout } from 'src/sections/shell/use-layout';
import { formatDistance, formatDuration } from 'src/sections/trips/planner/format';
import {
  googleDirectionsUrl,
  naverDirectionsUrl,
} from 'src/sections/trips/planner/naver-directions';
import type { PlannedLeg } from 'src/sections/trips/planner/use-day-plan';

const MODE_LABEL = { car: '자동차', walk: '도보', transit: '대중교통' } as const;

/** 구간 상태 문구(스펙 §6). 받은 경로는 문구가 없다. */
const STATUS_TEXT: Record<PlannedLeg['status'], string | null> = {
  routed: null,
  manual: null,
  abroad: '이동 시간은 구글맵에서 확인',
  estimated: '직선 추정',
  'no-route': '경로 없음 · 직선 추정',
  failed: '경로를 못 가져왔어요',
};

type Props = {
  leg: PlannedLeg;
  onMode(mode: PlannedLeg['mode']): void;
  onMinutes(minutes: number | null): void;
  onRetry(): void;
};

/**
 * 장소 행 사이의 구간 행: 수단(눌러 바꾸기) · 시간 · 거리 · 상태.
 * 직선 50km를 넘는 구간은 도보를 고를 수 없다.
 */
export function LegRow({ leg, onMode, onMinutes, onRetry }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(false);
  const save = () => {
    const minutes = draft.trim() === '' ? null : Number(draft);
    if (
      minutes !== null &&
      (!/^\d+$/.test(draft.trim()) || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
    ) {
      setError(true);
      return;
    }
    onMinutes(minutes);
    setEditing(false);
  };
  const status = STATUS_TEXT[leg.status];
  // 해외는 구글 웹, 국내는 좁은 화면에서 네이버 앱, 그 밖은 웹 길찾기. 주소를 못 만들면 링크를 숨긴다.
  const layout = useLayout();
  const abroad = isAbroadLeg(leg.from, leg.to);
  const directions = {
    from: { name: leg.from.name.value, lng: leg.from.lng, lat: leg.from.lat },
    to: { name: leg.to.name.value, lng: leg.to.lng, lat: leg.to.lat },
    mode: leg.mode,
  };
  const directionsUrl = abroad
    ? googleDirectionsUrl(directions)
    : naverDirectionsUrl(directions, layout === 'compact' ? 'app' : 'web');
  const isWebUrl = directionsUrl?.startsWith('https://') ?? false;
  const choose = (mode: PlannedLeg['mode']) => {
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
          '&:focus-visible': { outlineOffset: -2 },
        }}
      >
        {leg.mode === 'car' ? (
          <CarIcon aria-hidden="true" width={16} height={16} />
        ) : leg.mode === 'transit' ? (
          <BusIcon aria-hidden="true" width={16} height={16} />
        ) : (
          <FootprintsIcon aria-hidden="true" width={16} height={16} />
        )}
        <span>{MODE_LABEL[leg.mode]}</span>
      </Box>
      <span>
        {leg.status === 'manual'
          ? `${formatDuration(leg.time.durationS)} · 직접 입력 · ${formatDistance(leg.time.distanceM)}`
          : abroad
            ? `직선 ${formatDistance(leg.time.distanceM)}`
            : `${leg.mode === 'transit' && leg.status === 'estimated' ? '약 ' : ''}${formatDuration(leg.time.durationS)} · ${formatDistance(leg.time.distanceM)}`}
      </span>
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
          // 웹 길찾기만 새 탭으로 연다. 앱 주소(nmap://)는 새 탭이면 빈 탭이 남는다.
          {...(isWebUrl ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            minHeight: 44,
            px: 1,
            color: 'var(--tm-accent-text)',
            textDecoration: 'none',
            borderRadius: 'var(--tm-radius-md)',
            '&:hover': { textDecoration: 'underline' },
            '&:focus-visible': { outlineOffset: -2 },
          }}
        >
          {abroad ? '구글맵에서 길찾기' : '네이버 지도로 길찾기'}
        </Box>
      )}
      {editing && (
        <Box
          component="form"
          aria-label="구간 시간 직접 입력"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', py: 1 }}
        >
          <TextField
            id={inputId}
            label="구간 시간(분)"
            name="minutes"
            size="small"
            autoFocus
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(false);
            }}
            error={error}
            helperText={error ? '1~1440분으로 입력해 주세요' : '비우면 직접 입력한 시간을 지워요'}
            slotProps={{
              htmlInput: {
                inputMode: 'numeric',
                enterKeyHint: 'done',
                style: { width: '7rem', fontSize: '1rem' },
              },
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                event.currentTarget.closest('form')?.requestSubmit();
              }
            }}
          />
          <Button type="submit" sx={{ minHeight: 44 }}>
            저장
          </Button>
          <Button type="button" onClick={() => setEditing(false)} sx={{ minHeight: 44 }}>
            취소
          </Button>
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
        <MenuItem
          selected={leg.mode === 'transit'}
          onClick={() => choose('transit')}
          sx={{ minHeight: 44 }}
        >
          대중교통
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            setDraft(leg.minutes === null ? '' : String(leg.minutes));
            setError(false);
            setEditing(true);
          }}
          sx={{ minHeight: 44 }}
        >
          시간 직접 입력
        </MenuItem>
      </Menu>
    </Box>
  );
}
