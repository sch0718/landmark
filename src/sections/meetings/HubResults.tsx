import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useState, type ReactNode } from 'react';
import type { Hub } from 'src/domain/meeting/hubs';
import { rankRows } from 'src/domain/meeting/rank';
import type { MeetingRank, Participant } from 'src/schema/meeting';
import type { RouteLookupErrorCode } from 'src/services/errors';
import { TimeCells, formatMeetingValue } from './TimeCells';
import type { MeetingTimes } from './use-meeting-compute';

export function HubResults({
  hubs,
  participants,
  times,
  errors,
  rank,
  unit,
  onRank,
  onRetry,
  onAdd,
  renderNearby,
}: {
  hubs: readonly Hub[];
  participants: readonly Participant[];
  times: MeetingTimes;
  errors: Record<string, Record<string, RouteLookupErrorCode>>;
  rank: MeetingRank;
  unit: 'm' | 'min';
  onRank(rank: MeetingRank): void;
  onRetry(cid: string, pid: string): void;
  onAdd(hub: Hub): void;
  renderNearby(hub: Hub): ReactNode;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const active = participants.filter((p) => p.origin !== null);
  const rows = rankRows(
    hubs.map((h) => ({ ...h, values: active.map((p) => times[h.id]?.[p.id] ?? null) })),
    rank,
  );
  return (
    <Box component="section" aria-label="번화가 역 순위">
      <Box role="group" aria-label="순위 기준" sx={{ display: 'flex', flexWrap: 'wrap' }}>
        {(
          [
            ['max', '가장 먼 사람'],
            ['avg', '평균'],
            ['spread', '편차'],
          ] as const
        ).map(([r, label]) => (
          <Button
            key={r}
            sx={{ minHeight: 44 }}
            aria-pressed={rank === r}
            onClick={() => onRank(r)}
          >
            {label}
          </Button>
        ))}
      </Box>
      <Box component="ol" sx={{ p: 0, listStyle: 'none' }}>
        {rows.map((hub, index) => (
          <Box
            component="li"
            key={hub.id}
            sx={{ borderBottom: '1px solid var(--tm-border)', py: 1 }}
          >
            <Button
              aria-expanded={expanded === hub.id}
              onClick={() => setExpanded(expanded === hub.id ? null : hub.id)}
              sx={{ minHeight: 44 }}
            >
              {index + 1}. {hub.name} · {hub.region}
            </Button>
            {hub.score && (
              <Box sx={{ fontSize: 13 }}>
                최장 {formatMeetingValue(hub.score.max, unit)} · 평균{' '}
                {formatMeetingValue(hub.score.avg, unit)} · 편차{' '}
                {formatMeetingValue(hub.score.spread, unit)}
                {!hub.score.complete && ' · 일부 경로 없음'}
              </Box>
            )}
            <TimeCells
              id={hub.id}
              name={hub.name}
              participants={participants}
              values={times[hub.id]}
              errors={errors[hub.id]}
              unit={unit}
              onRetry={onRetry}
            />
            <Button
              onClick={() => onAdd(hub)}
              sx={{ minHeight: 44 }}
              aria-label={`${hub.name} 후보에 담기`}
            >
              역 후보에 담기
            </Button>
            {expanded === hub.id && renderNearby(hub)}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
