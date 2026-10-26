import type { OpCtx, OpResult } from 'src/domain/library/ops';
import type { Meeting } from 'src/schema/meeting';
import type { Library } from 'src/schema/library';
import { LIBRARY_LIMITS } from 'src/schema/library-base';
import type { OnlineState } from './online-doc';
import { meetingFailure, meetingField, storeMeeting } from './ops';

type OnlineSync = {
  syncedAt: string | null;
  docRev: number | null;
  seen: readonly string[];
  hostLikes: readonly string[] | null;
};
type OnlineMergeResult =
  | Extract<OpResult, { ok: false }>
  | (Extract<OpResult, { ok: true }> & { addedReplyOnly: string[]; hostLikes?: string[] });

/** 미전송 본문이 없고 서버 본문 버전이 다를 때만 다른 기기 본문을 받는다. */
export function shouldAdoptRemoteDoc(
  meeting: Meeting,
  state: OnlineState,
  sync: OnlineSync,
): boolean {
  const dirty =
    sync.syncedAt !== null &&
    [
      meeting.title,
      meeting.at,
      meeting.mode,
      meeting.participants,
      meeting.candidates,
      meeting.decided,
    ].some((field) => field.updatedAt > sync.syncedAt!);
  return (sync.docRev === null || state.docRev !== sync.docRev) && !dirty;
}

/** 다른 기기 본문과 서버 답장을 합치되 아직 올리지 않은 본문은 보존한다. */
export function mergeOnline(
  lib: Library,
  meetingId: string,
  state: OnlineState,
  ctx: OpCtx,
  sync: OnlineSync,
): OnlineMergeResult {
  const meeting = lib.meetings?.[meetingId];
  if (meeting === undefined || meeting.deletedAt !== null) return meetingFailure('not-found');
  let next = meeting;
  let hostLikes: string[] | undefined;
  const addedReplyOnly: string[] = [];
  if (shouldAdoptRemoteDoc(meeting, state, sync)) {
    const field = <T>(value: T) => ({ value, updatedAt: ctx.now });
    next = {
      ...meeting,
      title: field(state.doc.title),
      at: field(state.doc.at),
      mode: field(state.doc.mode),
      participants: field(state.doc.participants),
      candidates: field(state.doc.candidates),
      decided: field(state.doc.decided),
    };
  }
  const hostId = next.participants.value[0]?.id;
  const candidates = new Set(next.candidates.value.map((c) => c.id));
  for (const reply of state.replies) {
    const pid = reply.participantId;
    if (pid === hostId) {
      const previous = next.replies.value[pid];
      if (
        previous === undefined ||
        (sync.hostLikes !== null &&
          JSON.stringify(previous.likes) === JSON.stringify(sync.hostLikes))
      ) {
        hostLikes = reply.likes.filter((cid) => candidates.has(cid));
        next = meetingField(
          next,
          'replies',
          {
            ...next.replies.value,
            [pid]: {
              likes: hostLikes,
              sentAt: reply.updatedAt,
              receivedAt: ctx.now,
            },
          },
          ctx.now,
        );
      }
      continue;
    }
    const previous = next.replies.value[pid];
    const fresh = previous === undefined || previous.sentAt < reply.updatedAt;
    const participant = next.participants.value.find((p) => p.id === pid);
    if (participant === undefined) {
      if (state.doc.participants.some((p) => p.id === pid)) continue;
      // 서버 본문을 받으며 잠시 빠진 기존 참석자는 살리고, 이 기기에서 지운 사람만 건너뛴다.
      if (sync.seen.includes(pid) && !meeting.participants.value.some((p) => p.id === pid))
        continue;
      if (next.participants.value.length >= LIBRARY_LIMITS.meetingParticipantsMax) continue;
      next = meetingField(
        next,
        'participants',
        [
          ...next.participants.value,
          {
            id: pid,
            name: reply.name,
            origin: fresh
              ? reply.origin
              : (meeting.participants.value.find((p) => p.id === pid)?.origin ?? reply.origin),
          },
        ],
        ctx.now,
      );
      addedReplyOnly.push(pid);
    } else if (fresh && reply.origin !== null) {
      next = meetingField(
        next,
        'participants',
        next.participants.value.map((p) => (p.id === pid ? { ...p, origin: reply.origin } : p)),
        ctx.now,
      );
    }
    if (!fresh) continue;
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
  if (next.decided.value !== null && !candidates.has(next.decided.value))
    next = meetingField(next, 'decided', null, ctx.now);
  const participants = new Set(next.participants.value.map((p) => p.id));
  next = meetingField(
    next,
    'replies',
    Object.fromEntries(
      Object.entries(next.replies.value)
        .filter(([pid]) => participants.has(pid))
        .map(([pid, reply]) => [
          pid,
          { ...reply, likes: reply.likes.filter((cid) => candidates.has(cid)) },
        ]),
    ),
    ctx.now,
  );
  const result = storeMeeting(lib, next);
  return result.ok
    ? { ...result, addedReplyOnly, ...(hostLikes === undefined ? {} : { hostLikes }) }
    : result;
}
