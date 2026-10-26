import type { OpCtx, OpResult } from 'src/domain/library/ops';
import type { Meeting } from 'src/schema/meeting';
import type { Library } from 'src/schema/library';
import { LIBRARY_LIMITS } from 'src/schema/library-base';
import { docFromMeeting, type MeetingDoc, type OnlineState } from './online-doc';
import { meetingFailure, meetingField, storeMeeting } from './ops';

type OnlineSync = {
  syncedDoc: MeetingDoc | null;
  docRev: number | null;
  seen: readonly string[];
  hostLikes: readonly string[] | null;
};
type OnlineMergeResult =
  | Extract<OpResult, { ok: false }>
  | (Extract<OpResult, { ok: true }> & { addedReplyOnly: string[]; hostLikes?: string[] });

/** 답장 출발지·답장 전용 참석자를 빼고 주최자가 고친 본문만 비교한다. */
export function hostEdits(
  meeting: Meeting,
  syncedDoc: MeetingDoc,
  seen: readonly string[] = [],
): boolean {
  const syncedIds = new Set(syncedDoc.participants.map((p) => p.id));
  const project = (
    doc: Pick<MeetingDoc, 'title' | 'at' | 'mode' | 'candidates' | 'decided' | 'participants'>,
  ) => ({
    title: doc.title,
    at: doc.at,
    mode: doc.mode,
    candidates: doc.candidates,
    decided: doc.decided,
    participants: doc.participants
      .filter((p) => syncedIds.has(p.id) || !seen.includes(p.id))
      .map((p) => [p.id, p.name]),
  });
  return (
    JSON.stringify(
      project(docFromMeeting(meeting, {}, meeting.mode.value === 'straight' ? 'm' : 'min')),
    ) !== JSON.stringify(project(syncedDoc))
  );
}

/** 미전송 본문이 없고 서버 본문 버전이 더 높을 때만 다른 기기 본문을 받는다. */
export function shouldAdoptRemoteDoc(
  meeting: Meeting,
  state: OnlineState,
  sync: OnlineSync,
): boolean {
  const dirty = sync.syncedDoc !== null && hostEdits(meeting, sync.syncedDoc, sync.seen);
  return (sync.docRev === null || state.docRev > sync.docRev) && !dirty;
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
  const locallyRemoved = new Set(
    sync.seen.filter((id) => !meeting.participants.value.some((p) => p.id === id)),
  );
  let next = meeting;
  let hostLikes: string[] | undefined;
  const addedReplyOnly: string[] = [];
  const adopt = shouldAdoptRemoteDoc(meeting, state, sync);
  if (adopt) {
    const field = <T>(value: T) => ({ value, updatedAt: ctx.now });
    next = {
      ...meeting,
      title: field(state.doc.title),
      at: field(state.doc.at),
      mode: field(state.doc.mode),
      participants: field(state.doc.participants.filter((p) => !locallyRemoved.has(p.id))),
      candidates: field(state.doc.candidates),
      decided: field(state.doc.decided),
    };
  }
  const hostId = next.participants.value[0]?.id;
  const candidates = new Set(next.candidates.value.map((c) => c.id));
  for (const reply of state.replies) {
    const pid = reply.participantId;
    // 아직 올리지 않은 삭제는 다른 기기 본문과 답장으로 되살리지 않는다.
    if (locallyRemoved.has(pid)) continue;
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
    const fresh = previous === undefined || previous.sentAt !== reply.updatedAt;
    // 서버 본문보다 답장에 담긴 출발지가 최신이며, 이미 받은 답장에도 적용한다.
    const applyOrigin = (adopt || fresh) && reply.origin !== null;
    const participant = next.participants.value.find((p) => p.id === pid);
    if (participant === undefined) {
      if (state.doc.participants.some((p) => p.id === pid)) continue;
      if (next.participants.value.length >= LIBRARY_LIMITS.meetingParticipantsMax) continue;
      next = meetingField(
        next,
        'participants',
        [
          ...next.participants.value,
          {
            id: pid,
            name: reply.name,
            origin:
              fresh || applyOrigin
                ? reply.origin
                : (meeting.participants.value.find((p) => p.id === pid)?.origin ?? reply.origin),
          },
        ],
        ctx.now,
      );
      addedReplyOnly.push(pid);
    } else if (applyOrigin) {
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
