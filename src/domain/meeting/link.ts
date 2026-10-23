import { Schema } from 'effect';
import { CodecError, decodeCompressedJson, encodeCompressedJson } from 'src/domain/codec';
import { IsoDateTime, Lat, Lng } from 'src/schema/common';
import { LIBRARY_LIMITS } from 'src/schema/library-base';
import {
  MeetingAtSchema,
  MeetingId,
  MeetingMemberId,
  MeetingModeSchema,
  MeetingName,
  MeetingTitle,
  OriginSchema,
  ParticipantSchema,
  type Meeting,
} from 'src/schema/meeting';
import { safeParse } from 'src/schema/parse';
import { appUrl } from 'src/share-viewer/encode';

export const MEET_HASH_MAX = 8_000;
const MEET_BYTES_MAX = 65_536;
const base = { format: Schema.Literal('tripmap-meet'), v: Schema.Literal(1) };
const place = {
  name: MeetingTitle,
  address: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(120))),
  lng: Lng,
  lat: Lat,
};
const LinkCandidateSchema = Schema.Struct({
  id: MeetingMemberId,
  kind: Schema.Literals(['hub', 'place']),
  ...place,
});
const cell = Schema.NullOr(
  Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
);

export const InviteDocSchema = Schema.Struct({
  ...base,
  kind: Schema.Literal('d'),
  meetingId: MeetingId,
  title: MeetingTitle,
  at: MeetingAtSchema,
  mode: MeetingModeSchema,
  participants: Schema.Array(ParticipantSchema).check(
    Schema.isMaxLength(LIBRARY_LIMITS.meetingParticipantsMax),
  ),
  candidates: Schema.Array(LinkCandidateSchema).check(
    Schema.isMaxLength(LIBRARY_LIMITS.meetingCandidatesMax),
  ),
  times: Schema.Record(Schema.String, Schema.Record(Schema.String, cell)),
  unit: Schema.Literals(['min', 'm']),
  sentAt: IsoDateTime,
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
        Object.values(d.times).every((row) => Object.keys(row).every((pid) => pids.has(pid)))
      );
    },
    { message: '후보·참석자·시간의 참조나 단위가 올바르지 않습니다' },
  ),
);
export const ReplyDocSchema = Schema.Struct({
  ...base,
  kind: Schema.Literal('r'),
  meetingId: MeetingId,
  participantId: Schema.optionalKey(MeetingMemberId),
  newName: Schema.optionalKey(MeetingName),
  origin: Schema.optionalKey(Schema.NullOr(OriginSchema)),
  likes: Schema.Array(MeetingMemberId).check(
    Schema.isMaxLength(LIBRARY_LIMITS.meetingCandidatesMax),
  ),
  sentAt: IsoDateTime,
}).check(
  Schema.makeFilter(
    (d) =>
      (d.participantId === undefined) !== (d.newName === undefined) &&
      new Set(d.likes).size === d.likes.length,
    { message: '답장 신원은 하나여야 하고 좋아요는 중복될 수 없습니다' },
  ),
);
export const FinalDocSchema = Schema.Struct({
  ...base,
  kind: Schema.Literal('f'),
  title: MeetingTitle,
  at: MeetingAtSchema,
  mode: MeetingModeSchema,
  place: Schema.Struct(place),
  participants: Schema.Array(
    Schema.Struct({ name: MeetingName, origin: Schema.NullOr(OriginSchema) }),
  ).check(Schema.isMaxLength(LIBRARY_LIMITS.meetingParticipantsMax)),
});
export type InviteDoc = typeof InviteDocSchema.Type;
export type ReplyDoc = typeof ReplyDocSchema.Type;
export type FinalDoc = typeof FinalDocSchema.Type;
export type MeetDoc = InviteDoc | ReplyDoc | FinalDoc;
const MeetDocSchema = Schema.Union([InviteDocSchema, ReplyDocSchema, FinalDocSchema]);

export async function meetLink(
  doc: MeetDoc,
  app: string,
): Promise<{ ok: true; url: string } | { ok: false; reason: 'too-long' }> {
  if (new TextEncoder().encode(JSON.stringify(doc)).byteLength > MEET_BYTES_MAX)
    return { ok: false, reason: 'too-long' };
  const hash = `#${doc.kind}=${await encodeCompressedJson(doc)}`;
  return hash.length > MEET_HASH_MAX
    ? { ok: false, reason: 'too-long' }
    : { ok: true, url: `${appUrl(app)}/meet${hash}` };
}
export async function readMeetHash(
  hash: string,
): Promise<
  { ok: true; doc: MeetDoc } | { ok: false; reason: 'missing' | 'corrupt' | 'invalid' | 'too-long' }
> {
  if (hash === '' || hash === '#') return { ok: false, reason: 'missing' };
  if (hash.length > MEET_HASH_MAX) return { ok: false, reason: 'too-long' };
  const match = /^#([drf])=(.*)$/.exec(hash);
  if (match === null) return { ok: false, reason: 'invalid' };
  try {
    const json = await decodeCompressedJson(match[2]!, {
      maxChars: MEET_HASH_MAX,
      maxBytes: MEET_BYTES_MAX,
    });
    const parsed = safeParse(MeetDocSchema, json, { onExcessProperty: 'error' });
    if (!parsed.success || parsed.data.kind !== match[1]) return { ok: false, reason: 'invalid' };
    return { ok: true, doc: parsed.data };
  } catch (e) {
    return {
      ok: false,
      reason:
        e instanceof CodecError && (e.code === 'too-long' || e.code === 'too-large')
          ? 'too-long'
          : 'corrupt',
    };
  }
}

const candidatePlace = (c: Meeting['candidates']['value'][number]) => ({
  name: c.name,
  ...(c.address === undefined ? {} : { address: c.address }),
  lng: c.lng,
  lat: c.lat,
});
export function inviteFromMeeting(
  meeting: Meeting,
  times: InviteDoc['times'],
  unit: InviteDoc['unit'],
  now: string,
): InviteDoc {
  return {
    format: 'tripmap-meet',
    v: 1,
    kind: 'd',
    meetingId: meeting.id,
    title: meeting.title.value,
    at: meeting.at.value,
    mode: meeting.mode.value,
    participants: meeting.participants.value,
    candidates: meeting.candidates.value.map((c) => ({
      id: c.id,
      kind: c.kind,
      ...candidatePlace(c),
    })),
    times: Object.fromEntries(
      meeting.candidates.value.map((c) => [
        c.id,
        Object.fromEntries(
          meeting.participants.value.map((p) => [p.id, times[c.id]?.[p.id] ?? null]),
        ),
      ]),
    ),
    unit,
    sentAt: now,
  };
}
export function replyFromDraft(draft: Omit<ReplyDoc, 'format' | 'v' | 'kind'>): ReplyDoc {
  // 선택 키의 undefined는 직렬화 전에 없앤다.
  return {
    format: 'tripmap-meet',
    v: 1,
    kind: 'r',
    ...Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== undefined)),
  } as ReplyDoc;
}
export function finalFromMeeting(meeting: Meeting): FinalDoc | null {
  const decided = meeting.candidates.value.find((c) => c.id === meeting.decided.value);
  if (decided === undefined) return null;
  return {
    format: 'tripmap-meet',
    v: 1,
    kind: 'f',
    title: meeting.title.value,
    at: meeting.at.value,
    mode: meeting.mode.value,
    place: candidatePlace(decided),
    participants: meeting.participants.value.map((p) => ({ name: p.name, origin: p.origin })),
  };
}
