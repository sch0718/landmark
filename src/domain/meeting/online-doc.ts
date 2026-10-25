import { Schema } from 'effect';
import { IsoDateTime } from 'src/schema/common';
import { LIBRARY_LIMITS } from 'src/schema/library-base';
import {
  MeetingMemberId,
  MeetingName,
  MeetingTitle,
  OriginSchema,
  type Meeting,
} from 'src/schema/meeting';
import { InviteDocSchema, inviteFromMeeting, ReplyDocSchema, type InviteDoc } from './link';

export const MEET_DOC_BYTES_MAX = 65_536;
const { meetingId, title, at, mode, participants, candidates, times, unit } =
  InviteDocSchema.fields;

export const MeetingDocSchema = Schema.Struct({
  meetingId,
  title,
  at,
  mode,
  participants,
  candidates,
  times,
  unit,
  decided: Schema.NullOr(MeetingMemberId),
}).check(
  Schema.makeFilter(
    (d) => {
      const pids = new Set(d.participants.map((p) => p.id));
      const cids = new Set(d.candidates.map((c) => c.id));
      return (
        pids.size === d.participants.length &&
        cids.size === d.candidates.length &&
        d.unit === (d.mode === 'straight' ? 'm' : 'min') &&
        Object.keys(d.times).every((cid) => cids.has(cid)) &&
        Object.values(d.times).every((row) => Object.keys(row).every((pid) => pids.has(pid))) &&
        (d.decided === null || cids.has(d.decided))
      );
    },
    { message: '후보·참석자·시간·확정의 참조나 단위가 올바르지 않습니다' },
  ),
  Schema.makeFilter(
    (d) => new TextEncoder().encode(JSON.stringify(d)).byteLength <= MEET_DOC_BYTES_MAX,
    { message: '약속 본문은 64KB를 넘을 수 없습니다' },
  ),
);

const likes = ReplyDocSchema.fields.likes.check(
  Schema.makeFilter((ids) => new Set(ids).size === ids.length, {
    message: '좋아요는 중복될 수 없습니다',
  }),
);
const replyTimes = Schema.NullOr(
  Schema.Record(
    MeetingMemberId,
    Schema.NullOr(
      Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    ),
  ),
);

export const OnlineReplySchema = Schema.Struct({
  participantId: MeetingMemberId,
  name: MeetingName,
  origin: Schema.NullOr(OriginSchema),
  likes,
  times: replyTimes,
  updatedAt: IsoDateTime,
});
export const ReplyInputSchema = Schema.Struct({
  likes,
  origin: Schema.optionalKey(Schema.NullOr(OriginSchema)),
  times: Schema.optionalKey(replyTimes),
  docRev: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
});
export const OnlineStateSchema = Schema.Struct({
  rev: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  docRev: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  doc: MeetingDocSchema,
  replies: Schema.Array(OnlineReplySchema).check(
    Schema.isMaxLength(LIBRARY_LIMITS.meetingParticipantsMax),
  ),
  originNames: Schema.optionalKey(Schema.Record(MeetingMemberId, MeetingTitle)),
});
export type MeetingDoc = typeof MeetingDocSchema.Type;
export type OnlineReply = typeof OnlineReplySchema.Type;
export type ReplyInput = typeof ReplyInputSchema.Type;
export type OnlineState = typeof OnlineStateSchema.Type;

export function docFromMeeting(
  meeting: Meeting,
  times: InviteDoc['times'],
  unit: InviteDoc['unit'],
): MeetingDoc {
  const invite = inviteFromMeeting(meeting, times, unit, meeting.createdAt);
  return {
    meetingId: invite.meetingId,
    title: invite.title,
    at: invite.at,
    mode: invite.mode,
    participants: invite.participants,
    candidates: invite.candidates,
    times: invite.times,
    unit: invite.unit,
    decided: meeting.decided.value,
  };
}
