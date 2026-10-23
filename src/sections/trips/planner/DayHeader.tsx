import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useState } from 'react';
import { fieldSx } from 'src/components/field-style';
import { BedIcon, HomeIcon } from 'src/components/icons';
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
 * Day 머리: 출발 시각 입력, 출발점 이름, `순서 정리`, `여행 설정`, `일정 공유`.
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
      <Button size="small" onClick={onSettings} sx={{ minHeight: 44 }}>
        여행 설정
      </Button>
      <Button size="small" onClick={onShare} sx={{ minHeight: 44 }}>
        일정 공유
      </Button>
    </Box>
  );
}
