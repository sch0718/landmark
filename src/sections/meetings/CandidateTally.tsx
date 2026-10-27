import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import type { Meeting } from 'src/schema/meeting';
import type { RouteLookupErrorCode } from 'src/services/errors';
import { TimeCells } from './TimeCells';
import type { MeetingTimes } from './use-meeting-compute';

export function CandidateTally({
  meeting,
  times,
  errors,
  unit,
  onLike,
  onRemove,
  onDecide,
  onRetry,
  participantId,
}: {
  meeting: Meeting;
  times: MeetingTimes;
  errors: Record<string, Record<string, RouteLookupErrorCode>>;
  unit: 'm' | 'min';
  participantId?: string | null;
  onLike(cid: string): void;
  onRemove?(cid: string): void;
  onDecide?(cid: string | null): void;
  onRetry(cid: string, pid: string): void;
}) {
  const actorId = participantId === undefined ? meeting.participants.value[0]?.id : participantId;
  return (
    <Box component="section" aria-label="후보와 집계">
      <Box component="h2" sx={{ fontSize: 18 }}>
        후보와 집계
      </Box>
      {meeting.candidates.value.length === 0 && <p>역이나 보관함 장소를 후보에 담아 주세요</p>}
      <Box component="ul" aria-label="약속 후보" sx={{ p: 0, listStyle: 'none' }}>
        {meeting.candidates.value.map((c) => {
          const names = meeting.participants.value
            .filter((p) => meeting.replies.value[p.id]?.likes.includes(c.id))
            .map((p) => p.name);
          const decided = meeting.decided.value === c.id;
          return (
            <Box
              component="li"
              key={c.id}
              aria-label={c.name}
              sx={{ my: 1, p: 1, border: '1px solid var(--tm-border)', borderRadius: 2 }}
            >
              <Box component="h3" sx={{ m: 0, fontSize: 16 }}>
                {c.name}
                {decided && ' · 확정'}
              </Box>
              <p>{`좋아요 ${names.length}명${names.length > 0 ? ` · ${names.join(', ')}` : ''}`}</p>
              <TimeCells
                id={c.id}
                name={c.name}
                participants={meeting.participants.value}
                values={times[c.id]}
                errors={errors[c.id]}
                unit={unit}
                onRetry={onRetry}
              />
              <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
                <Button
                  disabled={!actorId}
                  aria-pressed={
                    actorId
                      ? (meeting.replies.value[actorId]?.likes.includes(c.id) ?? false)
                      : false
                  }
                  aria-label={`${c.name} 좋아요`}
                  onClick={() => onLike(c.id)}
                  sx={{ minHeight: 44 }}
                >
                  좋아요
                </Button>
                {onDecide && (
                  <Button
                    aria-label={`${c.name} ${decided ? '확정 취소' : '확정'}`}
                    onClick={() => onDecide(decided ? null : c.id)}
                    sx={{ minHeight: 44 }}
                  >
                    {decided ? '확정 취소' : '확정'}
                  </Button>
                )}
                {onRemove && (
                  <Button
                    aria-label={`${c.name} 후보 빼기`}
                    onClick={() => onRemove(c.id)}
                    sx={{ minHeight: 44 }}
                  >
                    후보 빼기
                  </Button>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
