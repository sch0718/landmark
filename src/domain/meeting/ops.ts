import { setField, type Field } from 'src/domain/library/lww';
import type { OpCtx, OpResult } from 'src/domain/library/ops';
import { haversineM } from 'src/domain/trips/geo';
import { LIBRARY_LIMITS, type Library } from 'src/schema/library';
import {
  checkMeeting,
  MeetingSchema,
  type Candidate,
  type Meeting,
  type Participant,
} from 'src/schema/meeting';
import { safeParse } from 'src/schema/parse';

export type MeetingOpError =
  | 'not-found'
  | 'participants-full'
  | 'candidates-full'
  | 'candidate-exists'
  | 'meetings-full'
  | 'host'
  | 'invalid';
export type MeetingError = { _tag: 'MeetingOpError'; reason: MeetingOpError };
export const meetingFailure = (reason: MeetingOpError): OpResult => ({
  ok: false,
  error: { _tag: 'MeetingOpError', reason },
});

/** 스키마와 참조를 확인한 뒤 한 번에 바꾼다. 입력 문서는 건드리지 않는다. */
export function storeMeeting(lib: Library, meeting: Meeting): OpResult {
  const parsed = safeParse(MeetingSchema, meeting);
  if (!parsed.success || checkMeeting(parsed.data, []).length > 0) return meetingFailure('invalid');
  const before = lib.meetings?.[meeting.id];
  return {
    ok: true,
    lib:
      before === meeting ? lib : { ...lib, meetings: { ...lib.meetings, [meeting.id]: meeting } },
  };
}

function change(
  lib: Library,
  id: string,
  update: (m: Meeting) => Meeting | MeetingOpError,
): OpResult {
  const meeting = lib.meetings?.[id];
  if (meeting === undefined || meeting.deletedAt !== null) return meetingFailure('not-found');
  const next = update(meeting);
  return typeof next === 'string' ? meetingFailure(next) : storeMeeting(lib, next);
}

type FieldKey =
  'title' | 'at' | 'mode' | 'rank' | 'participants' | 'candidates' | 'replies' | 'decided';
export function meetingField<K extends FieldKey>(
  m: Meeting,
  key: K,
  value: Meeting[K]['value'],
  now: string,
): Meeting {
  const current = m[key] as Field<Meeting[K]['value']>;
  const next = setField(current, value, now);
  return next === current ? m : { ...m, [key]: next };
}

type MeetingInput = {
  title: string;
  at: Meeting['at']['value'];
  mode: Meeting['mode']['value'];
  hostName?: string;
};
export function createMeeting(lib: Library, input: MeetingInput, ctx: OpCtx): OpResult {
  if (Object.keys(lib.meetings ?? {}).length >= LIBRARY_LIMITS.meetingsMax)
    return meetingFailure('meetings-full');
  const f = <T>(value: T) => ({ value, updatedAt: ctx.now });
  const id = ctx.newId('meeting');
  if (lib.meetings?.[id] !== undefined) return meetingFailure('invalid');
  const result = storeMeeting(lib, {
    id,
    title: f(input.title.trim()),
    at: f(input.at),
    mode: f(input.mode),
    rank: f('max'),
    participants: f([
      { id: ctx.newId('meetingMember'), name: (input.hostName ?? '나').trim(), origin: null },
    ]),
    candidates: f([]),
    replies: f({}),
    decided: f(null),
    createdAt: ctx.now,
    deletedAt: null,
  });
  return result.ok ? { ...result, createdId: id } : result;
}

export function updateMeeting(
  lib: Library,
  id: string,
  patch: Partial<Pick<MeetingInput, 'title' | 'at' | 'mode'> & { rank: Meeting['rank']['value'] }>,
  ctx: OpCtx,
): OpResult {
  return change(lib, id, (m) => {
    let next = m;
    if (patch.title !== undefined) next = meetingField(next, 'title', patch.title.trim(), ctx.now);
    if (patch.at !== undefined) next = meetingField(next, 'at', patch.at, ctx.now);
    if (patch.mode !== undefined) next = meetingField(next, 'mode', patch.mode, ctx.now);
    if (patch.rank !== undefined) next = meetingField(next, 'rank', patch.rank, ctx.now);
    return next;
  });
}
export function deleteMeeting(lib: Library, id: string, ctx: OpCtx): OpResult {
  return change(lib, id, (m) => ({ ...m, deletedAt: ctx.now }));
}
export function restoreMeeting(lib: Library, id: string, _ctx: OpCtx): OpResult {
  void _ctx;
  const m = lib.meetings?.[id];
  return m === undefined
    ? meetingFailure('not-found')
    : storeMeeting(lib, m.deletedAt === null ? m : { ...m, deletedAt: null });
}
export function addParticipant(
  lib: Library,
  id: string,
  info: Omit<Participant, 'id'>,
  ctx: OpCtx,
): OpResult {
  return change(lib, id, (m) =>
    m.participants.value.length >= LIBRARY_LIMITS.meetingParticipantsMax
      ? 'participants-full'
      : meetingField(
          m,
          'participants',
          [
            ...m.participants.value,
            { ...info, name: info.name.trim(), id: ctx.newId('meetingMember') },
          ],
          ctx.now,
        ),
  );
}
export function updateParticipant(
  lib: Library,
  id: string,
  pid: string,
  patch: Partial<Omit<Participant, 'id'>>,
  ctx: OpCtx,
): OpResult {
  return change(lib, id, (m) =>
    !m.participants.value.some((p) => p.id === pid)
      ? 'not-found'
      : meetingField(
          m,
          'participants',
          m.participants.value.map((p) =>
            p.id === pid ? { ...p, ...patch, name: (patch.name ?? p.name).trim() } : p,
          ),
          ctx.now,
        ),
  );
}
export function removeParticipant(lib: Library, id: string, pid: string, ctx: OpCtx): OpResult {
  return change(lib, id, (m) => {
    if (m.participants.value[0]?.id === pid) return 'host';
    if (!m.participants.value.some((p) => p.id === pid)) return 'not-found';
    const next = meetingField(
      m,
      'participants',
      m.participants.value.filter((p) => p.id !== pid),
      ctx.now,
    );
    return meetingField(
      next,
      'replies',
      Object.fromEntries(Object.entries(m.replies.value).filter(([key]) => key !== pid)),
      ctx.now,
    );
  });
}
export function addCandidate(
  lib: Library,
  id: string,
  info: Omit<Candidate, 'id'>,
  ctx: OpCtx,
): OpResult {
  return change(lib, id, (m) => {
    if (m.candidates.value.length >= LIBRARY_LIMITS.meetingCandidatesMax) return 'candidates-full';
    if (
      m.candidates.value.some(
        (c) =>
          (info.hubId !== undefined && c.hubId === info.hubId) ||
          (info.placeId !== undefined && c.placeId === info.placeId) ||
          (c.name === info.name.trim() && haversineM([c.lng, c.lat], [info.lng, info.lat]) <= 50),
      )
    )
      return 'candidate-exists';
    return meetingField(
      m,
      'candidates',
      [...m.candidates.value, { ...info, name: info.name.trim(), id: ctx.newId('meetingMember') }],
      ctx.now,
    );
  });
}
export function removeCandidate(lib: Library, id: string, cid: string, ctx: OpCtx): OpResult {
  return change(lib, id, (m) => {
    if (!m.candidates.value.some((c) => c.id === cid)) return 'not-found';
    let next = meetingField(
      m,
      'candidates',
      m.candidates.value.filter((c) => c.id !== cid),
      ctx.now,
    );
    next = meetingField(
      next,
      'replies',
      Object.fromEntries(
        Object.entries(m.replies.value).map(([key, r]) => [
          key,
          { ...r, likes: r.likes.filter((like) => like !== cid) },
        ]),
      ),
      ctx.now,
    );
    return m.decided.value === cid ? meetingField(next, 'decided', null, ctx.now) : next;
  });
}
export function toggleLike(
  lib: Library,
  id: string,
  pid: string,
  cid: string,
  ctx: OpCtx,
): OpResult {
  return change(lib, id, (m) => {
    if (
      !m.participants.value.some((p) => p.id === pid) ||
      !m.candidates.value.some((c) => c.id === cid)
    )
      return 'invalid';
    const likes = m.replies.value[pid]?.likes ?? [];
    return meetingField(
      m,
      'replies',
      {
        ...m.replies.value,
        [pid]: {
          likes: likes.includes(cid) ? likes.filter((c) => c !== cid) : [...likes, cid],
          sentAt: ctx.now,
          receivedAt: ctx.now,
        },
      },
      ctx.now,
    );
  });
}
export function decide(lib: Library, id: string, cid: string | null, ctx: OpCtx): OpResult {
  return change(lib, id, (m) =>
    cid !== null && !m.candidates.value.some((c) => c.id === cid)
      ? 'invalid'
      : meetingField(m, 'decided', cid, ctx.now),
  );
}
