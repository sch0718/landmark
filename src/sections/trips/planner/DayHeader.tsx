import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useState } from 'react';
import { fieldSx } from 'src/components/field-style';
import { BedIcon, EllipsisIcon, HomeIcon } from 'src/components/icons';
import { TruncatedText } from 'src/components/TruncatedText';
import type { Place } from 'src/schema/library';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

type Props = {
  dayIndex: number;
  /** 저장된 출발 시각('HH:mm'). */
  startTime: string;
  /** 출발점(1일차는 여행 출발지, 그 뒤는 전날 숙소). 없으면 첫 장소에서 출발한다. */
  start: Place | null;
  onStartTime(value: string): void;
  /** 순서를 바꿀 만큼 장소가 있는가(2곳 이상). 아니면 `순서 정리`는 꺼진다. */
  canOptimize: boolean;
  onOptimize(): void;
  onSettings(): void;
  /** `일정 공유` 창을 연다. */
  onShare(): void;
};

/**
 * Day 머리: 출발 시각 입력, 출발점 이름, `순서 정리`, `여행 메뉴`(`이름·기간 바꾸기`·`일정 공유`).
 * 두 동작은 제목 옆 단추에도 있다. 여기 메뉴는 후보 칸(제목)이 안 보일 때(접힌 칸·Day 탭) 쓴다.
 * 출발 시각은 형식이 맞는 값('HH:mm')만 저장하고, 비우거나 틀린 채로 나가면 저장된 값으로 되돌린다.
 * Day가 바뀌면 부른 쪽이 `key`로 새로 만든다.
 */
export function DayHeader({
  dayIndex,
  startTime,
  start,
  onStartTime,
  canOptimize,
  onOptimize,
  onSettings,
  onShare,
}: Props) {
  // 입력 중인 값. 저장된 값이 바뀌면(저장 성공·다른 탭) 그 값으로 맞춘다.
  const [draft, setDraft] = useState({ base: startTime, value: startTime });
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const pick = (action: () => void) => {
    setMenu(null);
    action();
  };
  let value = draft.value;
  if (draft.base !== startTime) {
    setDraft({ base: startTime, value: startTime }); // 렌더 중 상태 갱신
    value = startTime;
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: 1,
        borderBottom: '1px solid var(--tm-border)',
      }}
    >
      <Box
        component="input"
        type="time"
        aria-label="출발 시각"
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          setDraft({ base: startTime, value: next });
          if (HHMM.test(next) && next !== startTime) onStartTime(next);
        }}
        onBlur={() => {
          if (!HHMM.test(value)) setDraft({ base: startTime, value: startTime });
        }}
        sx={[fieldSx(), { width: 'auto', fontVariantNumeric: 'tabular-nums' }]}
      />
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          fontSize: 14,
          color: start === null ? 'var(--tm-text-muted)' : 'var(--tm-text-primary)',
          '& svg': { flex: 'none', width: 16, height: 16 },
        }}
      >
        {start !== null &&
          (dayIndex === 0 ? (
            <HomeIcon aria-hidden="true" />
          ) : (
            <BedIcon aria-hidden="true" width={16} height={16} />
          ))}
        <TruncatedText>{start === null ? '첫 장소에서 출발' : start.name.value}</TruncatedText>
      </Box>
      <Button size="small" disabled={!canOptimize} onClick={onOptimize} sx={{ minHeight: 44 }}>
        순서 정리
      </Button>
      <IconButton
        aria-label="여행 메뉴"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onClick={(event) => setMenu(event.currentTarget)}
        sx={{ width: 44, height: 44 }}
      >
        <EllipsisIcon aria-hidden="true" width={20} height={20} />
      </IconButton>
      <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => pick(onSettings)} sx={{ minHeight: 44 }}>
          이름·기간 바꾸기
        </MenuItem>
        <MenuItem onClick={() => pick(onShare)} sx={{ minHeight: 44 }}>
          일정 공유
        </MenuItem>
      </Menu>
    </Box>
  );
}
