import { Schema } from 'effect';
import { IsoDateTime } from 'src/schema/common';
import { MeetingId, MeetingMemberId, type Meeting } from 'src/schema/meeting';
import { safeParse } from 'src/schema/parse';
import { LIBRARY_LIMITS } from 'src/schema/library-base';

export const MEET_ONLINE_KEY = 'tripmap:meet-online:v1';
export type OnlineRecord = {
  hostToken?: string;
  pendingHostToken?: string;
  hostLikes?: string[];
  guest?: { participantId: string; token: string };
  lastRev: number;
  docRev?: number;
  syncedAt?: string;
  seen?: string[];
  ended?: true;
};
const nonempty = Schema.String.check(Schema.isMinLength(1));
const recordSchema = Schema.Struct({
  hostToken: Schema.optionalKey(nonempty),
  pendingHostToken: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/)),
  ),
  hostLikes: Schema.optionalKey(
    Schema.mutable(Schema.Array(MeetingMemberId)).check(
      Schema.isMaxLength(LIBRARY_LIMITS.meetingCandidatesMax),
    ),
  ),
  guest: Schema.optionalKey(Schema.Struct({ participantId: MeetingMemberId, token: nonempty })),
  lastRev: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  docRev: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
  syncedAt: Schema.optionalKey(IsoDateTime),
  seen: Schema.optionalKey(
    Schema.mutable(Schema.Array(MeetingMemberId)).check(
      Schema.isMaxLength(LIBRARY_LIMITS.meetingParticipantsMax),
    ),
  ),
  ended: Schema.optionalKey(Schema.Literal(true)),
});

/** 보관함·백업과 따로 저장한다. 저장소가 막히면 이번 페이지에서는 메모리만 쓴다. */
export function createOnlineStore(storage: () => Storage = () => window.localStorage) {
  let memory = new Map<string, OnlineRecord>();
  let memoryOnly = false;
  function read() {
    if (memoryOnly) return memory;
    let raw: string | null;
    try {
      raw = storage().getItem(MEET_ONLINE_KEY);
    } catch {
      memoryOnly = true;
      return memory;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw ?? '{}');
    } catch {
      parsed = null;
    }
    memory = new Map();
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      for (const [id, value] of Object.entries(parsed)) {
        const result = safeParse(recordSchema, value);
        if (safeParse(MeetingId, id).success && result.success) memory.set(id, result.data);
      }
    }
    trim();
    return memory;
  }
  function trim() {
    while (memory.size > 200) memory.delete(memory.keys().next().value!);
  }
  function save() {
    if (memoryOnly) return;
    try {
      storage().setItem(MEET_ONLINE_KEY, JSON.stringify(Object.fromEntries(memory)));
    } catch {
      memoryOnly = true;
    }
  }
  function allOnline(): Record<string, OnlineRecord> {
    return structuredClone(Object.fromEntries(read()));
  }
  function readOnline(id: string): OnlineRecord | null {
    const record = read().get(id);
    return record ? structuredClone(record) : null;
  }
  function writeOnline(id: string, record: OnlineRecord): void {
    read();
    // 다시 쓴 기록을 마지막으로 옮겨, 별도 시각 필드 없이 오래된 기록부터 버린다.
    memory.delete(id);
    memory.set(id, structuredClone(record));
    trim();
    save();
  }
  function removeOnline(id: string): void {
    read();
    memory.delete(id);
    save();
  }
  return { allOnline, readOnline, writeOnline, removeOnline };
}

export const { allOnline, readOnline, writeOnline, removeOnline } = createOnlineStore();

/** 한도가 차면 서버에 아직 있는 참석자의 삭제 기록부터 지킨다. */
export function rememberReplyOnly(
  seen: readonly string[],
  added: readonly string[],
  activeIds: readonly string[],
): string[] {
  const ids = [...new Set([...seen, ...added])];
  const active = new Set(activeIds);
  return [...ids.filter((id) => !active.has(id)), ...ids.filter((id) => active.has(id))].slice(
    -LIBRARY_LIMITS.meetingParticipantsMax,
  );
}

export function isLinkMeeting(meeting: Meeting, record: OnlineRecord | null): boolean {
  const hostId = meeting.participants.value[0]?.id;
  return !record?.hostToken && Object.keys(meeting.replies.value).some((id) => id !== hostId);
}
