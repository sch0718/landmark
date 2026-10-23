import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import type { Participant } from 'src/schema/meeting';
import type { RouteLookupErrorCode } from 'src/services/errors';
import { formatDistance, formatDuration } from 'src/sections/trips/planner/format';

export function formatMeetingValue(value: number | null | undefined, unit: 'm' | 'min') {
  return value == null ? '—' : unit === 'm' ? formatDistance(value) : formatDuration(value * 60);
}
const ERROR_TEXT: Record<RouteLookupErrorCode, string> = {
  OFFLINE: '오프라인이에요',
  TIMEOUT: '조회 시간이 오래 걸려요',
  NO_ROUTE: '경로가 없어요',
  UPSTREAM_ERROR: '경로를 가져오지 못했어요',
  BAD_REQUEST: '출발지와 조건을 확인해 주세요',
  FORBIDDEN_ORIGIN: '경로 조회를 사용할 수 없어요',
};
export function TimeCells({
  id,
  name,
  participants,
  values,
  errors,
  unit,
  onRetry,
}: {
  id: string;
  name: string;
  participants: readonly Participant[];
  values?: Record<string, number | null>;
  errors?: Record<string, RouteLookupErrorCode>;
  unit: 'min' | 'm';
  onRetry(cid: string, pid: string): void;
}) {
  return (
    <Box component="dl" sx={{ m: 0 }}>
      {participants.map((p) => (
        <Box key={p.id} sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Box component="dt">{p.name}</Box>
          <Box component="dd" sx={{ m: 0 }}>
            {formatMeetingValue(values?.[p.id], unit)}
          </Box>
          {errors?.[p.id] && (
            <>
              <span>{ERROR_TEXT[errors[p.id]!]}</span>
              <Button
                sx={{ minHeight: 44 }}
                aria-label={`${name} ${p.name} 다시 시도`}
                onClick={() => onRetry(id, p.id)}
              >
                다시 시도
              </Button>
            </>
          )}
        </Box>
      ))}
    </Box>
  );
}
