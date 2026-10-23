import type { OpCtx, OpResult } from 'src/domain/library/ops';
import type { Library } from 'src/schema/library';
import { LIBRARY_LIMITS } from 'src/schema/library-base';
import type { Meeting } from 'src/schema/meeting';
import { safeParse } from 'src/schema/parse';
import { ReplyDocSchema, type ReplyDoc } from './link';
import { meetingFailure, meetingField, storeMeeting } from './ops';

export type ReplyPreview =
  | {
      kind: 'ok';
      participant: { id?: string; name: string; isNew: boolean };
      likes: string[];
      droppedLikes: number;
      originChanged: boolean;
    }
  | { kind: 'stale' | 'full' | 'other-meeting' };
export type ReplyRejected = { _tag: 'ReplyRejected'; reason: 'stale' | 'full' | 'other-meeting' };
const normalizeName = (name: string) => name.normalize('NFC').trim().replace(/\s+/g, ' ');

export function previewReply(meeting: Meeting, doc: ReplyDoc): ReplyPreview {
  if (meeting.id !== doc.meetingId) return { kind: 'other-meeting' };
  const participant =
    doc.participantId !== undefined
      ? meeting.participants.value.find((p) => p.id === doc.participantId)
      : meeting.participants.value.find(
          (p) => normalizeName(p.name) === normalizeName(doc.newName ?? ''),
        );
  if (doc.participantId !== undefined && participant === undefined)
    return { kind: 'other-meeting' };
  if (
    participant === undefined &&
    meeting.participants.value.length >= LIBRARY_LIMITS.meetingParticipantsMax
  )
    return { kind: 'full' };
  const previous = participant === undefined ? undefined : meeting.replies.value[participant.id];
  if (previous !== undefined && doc.sentAt < previous.sentAt) return { kind: 'stale' };
  const candidates = new Set(meeting.candidates.value.map((c) => c.id));
  const likes = [...new Set(doc.likes.filter((id) => candidates.has(id)))];
  return {
    kind: 'ok',
    participant: {
      ...(participant === undefined ? {} : { id: participant.id }),
      name: participant?.name ?? normalizeName(doc.newName ?? ''),
      isNew: participant === undefined,
    },
    likes,
    droppedLikes: doc.likes.length - likes.length,
    originChanged:
      doc.origin !== undefined &&
      JSON.stringify(doc.origin) !== JSON.stringify(participant?.origin ?? null),
  };
}

export function applyReply(lib: Library, meetingId: string, doc: ReplyDoc, ctx: OpCtx): OpResult {
  const meeting = lib.meetings?.[meetingId];
  if (meeting === undefined || meeting.deletedAt !== null) return meetingFailure('not-found');
  if (!safeParse(ReplyDocSchema, doc, { onExcessProperty: 'error' }).success)
    return meetingFailure('invalid');
  const preview = previewReply(meeting, doc);
  if (preview.kind !== 'ok')
    return { ok: false, error: { _tag: 'ReplyRejected', reason: preview.kind } };
  const pid = preview.participant.id ?? ctx.newId('meetingMember');
  const participants = preview.participant.isNew
    ? [
        ...meeting.participants.value,
        { id: pid, name: preview.participant.name, origin: doc.origin ?? null },
      ]
    : meeting.participants.value.map((p) =>
        p.id === pid && doc.origin !== undefined ? { ...p, origin: doc.origin } : p,
      );
  const next = meetingField(meeting, 'participants', participants, ctx.now);
  return storeMeeting(
    lib,
    meetingField(
      next,
      'replies',
      {
        ...meeting.replies.value,
        [pid]: { likes: preview.likes, sentAt: doc.sentAt, receivedAt: ctx.now },
      },
      ctx.now,
    ),
  );
}
