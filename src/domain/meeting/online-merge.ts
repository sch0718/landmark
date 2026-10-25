import type { OpCtx, OpResult } from 'src/domain/library/ops';
import type { Library } from 'src/schema/library';
import { LIBRARY_LIMITS } from 'src/schema/library-base';
import type { OnlineState } from './online-doc';
import { meetingFailure, meetingField, storeMeeting } from './ops';

/** 서버 답장을 반영하고 주최자 본문과 아직 보내지 않은 확정을 보존한다. */
export function mergeOnline(
  lib: Library,
  meetingId: string,
  state: OnlineState,
  ctx: OpCtx,
  syncedAt: string | null,
): OpResult {
  const meeting = lib.meetings?.[meetingId];
  if (meeting === undefined || meeting.deletedAt !== null) return meetingFailure('not-found');
  const hostId = meeting.participants.value[0]?.id;
  const candidates = new Set(meeting.candidates.value.map((c) => c.id));
  let next = meeting;
  for (const reply of state.replies) {
    const pid = reply.participantId;
    if (pid === hostId) continue;
    const previous = next.replies.value[pid];
    if (previous !== undefined && previous.sentAt >= reply.updatedAt) continue;

    const participant = next.participants.value.find((p) => p.id === pid);
    if (participant === undefined) {
      if (next.participants.value.length >= LIBRARY_LIMITS.meetingParticipantsMax) continue;
      next = meetingField(
        next,
        'participants',
        [...next.participants.value, { id: pid, name: reply.name, origin: reply.origin }],
        ctx.now,
      );
    } else if (reply.origin !== null) {
      next = meetingField(
        next,
        'participants',
        next.participants.value.map((p) => (p.id === pid ? { ...p, origin: reply.origin } : p)),
        ctx.now,
      );
    }
    next = meetingField(
      next,
      'replies',
      {
        ...next.replies.value,
        [pid]: {
          likes: reply.likes.filter((id) => candidates.has(id)),
          sentAt: reply.updatedAt,
          receivedAt: ctx.now,
        },
      },
      ctx.now,
    );
  }
  if (
    meeting.decided.value !== state.doc.decided &&
    (syncedAt === null || meeting.decided.updatedAt <= syncedAt)
  ) {
    next = meetingField(next, 'decided', state.doc.decided, ctx.now);
  }
  return storeMeeting(lib, next);
}
