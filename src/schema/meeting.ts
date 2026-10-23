import { Schema } from 'effect';
import { CalendarDate, HHmm, IsoDateTime, Lat, Lng } from 'src/schema/common';
import { FieldSchema, LIBRARY_LIMITS, PlaceId } from 'src/schema/library-base';

export const MeetingId = Schema.String.check(Schema.isPattern(/^[a-z0-9]{10}$/));
export const MeetingMemberId = Schema.String.check(Schema.isPattern(/^[a-z0-9]{8}$/));
export const MeetingTitle = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(LIBRARY_LIMITS.meetingTitleChars),
);
export const MeetingName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(LIBRARY_LIMITS.meetingNameChars),
);
export const MeetingAtSchema = Schema.NullOr(Schema.Struct({ date: CalendarDate, time: HHmm }));
export const MeetingModeSchema = Schema.Literals(['transit', 'car', 'straight']);
export const MeetingRankSchema = Schema.Literals(['max', 'avg', 'spread']);
export const OriginSchema = Schema.Struct({
  name: MeetingTitle,
  lng: Lng,
  lat: Lat,
  placeId: Schema.optionalKey(PlaceId),
});
export const ParticipantSchema = Schema.Struct({
  id: MeetingMemberId,
  name: MeetingName,
  origin: Schema.NullOr(OriginSchema),
});
export const CandidateSchema = Schema.Struct({
  id: MeetingMemberId,
  kind: Schema.Literals(['hub', 'place']),
  name: MeetingTitle,
  address: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(120))),
  lng: Lng,
  lat: Lat,
  hubId: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(8))),
  placeId: Schema.optionalKey(PlaceId),
});
export const ReplySchema = Schema.Struct({
  likes: Schema.Array(MeetingMemberId),
  sentAt: IsoDateTime,
  receivedAt: IsoDateTime,
});
export const MeetingSchema = Schema.Struct({
  id: MeetingId,
  title: FieldSchema(MeetingTitle),
  at: FieldSchema(MeetingAtSchema),
  mode: FieldSchema(MeetingModeSchema),
  rank: FieldSchema(MeetingRankSchema),
  participants: FieldSchema(
    Schema.Array(ParticipantSchema).check(
      Schema.isMaxLength(LIBRARY_LIMITS.meetingParticipantsMax),
    ),
  ),
  candidates: FieldSchema(
    Schema.Array(CandidateSchema).check(Schema.isMaxLength(LIBRARY_LIMITS.meetingCandidatesMax)),
  ),
  replies: FieldSchema(Schema.Record(Schema.String, ReplySchema)),
  decided: FieldSchema(Schema.NullOr(MeetingMemberId)),
  createdAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type Meeting = typeof MeetingSchema.Type;
export type Participant = typeof ParticipantSchema.Type;
export type Candidate = typeof CandidateSchema.Type;
export type Origin = typeof OriginSchema.Type;
export type MeetingMode = typeof MeetingModeSchema.Type;
export type MeetingRank = typeof MeetingRankSchema.Type;
export type Reply = typeof ReplySchema.Type;

/** 약속 안의 참조 관계를 검사한다. */
export function checkMeeting(meeting: Meeting, path: PropertyKey[]): Schema.FilterIssue[] {
  const issues: Schema.FilterIssue[] = [];
  const add = (sub: PropertyKey[], issue: string) =>
    issues.push({ path: [...path, ...sub], issue });
  const ids = (key: 'participants' | 'candidates') => {
    const seen = new Set<string>();
    meeting[key].value.forEach((item, i) => {
      if (seen.has(item.id)) add([key, 'value', i, 'id'], 'id가 중복됩니다');
      seen.add(item.id);
    });
    return seen;
  };
  const participants = ids('participants');
  const candidates = ids('candidates');
  for (const [pid, reply] of Object.entries(meeting.replies.value)) {
    if (!participants.has(pid)) add(['replies', 'value', pid], '없는 참석자입니다');
    const seen = new Set<string>();
    reply.likes.forEach((cid, i) => {
      if (!candidates.has(cid) || seen.has(cid))
        add(['replies', 'value', pid, 'likes', i], '없거나 중복된 후보입니다');
      seen.add(cid);
    });
  }
  if (meeting.decided.value !== null && !candidates.has(meeting.decided.value))
    add(['decided', 'value'], '없는 후보입니다');
  return issues;
}
