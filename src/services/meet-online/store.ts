import { Schema } from 'effect';
import { MeetingDocSchema, type MeetingDoc } from 'src/domain/meeting/online-doc';
import {
  MeetingId,
  MeetingMemberId,
  MeetingName,
  OriginSchema,
  type Meeting,
  type Origin,
} from 'src/schema/meeting';
import { safeParse } from 'src/schema/parse';
import { LIBRARY_LIMITS } from 'src/schema/library-base';

export const MEET_ONLINE_KEY = 'tripmap:meet-online:v1';
export type OnlineRecord = {
  hostToken?: string;
  pendingHostToken?: string;
  hostLikes?: string[];
  hostLikesAckRev?: number;
  guest?: { participantId: string; token: string };
  pendingGuest?: { participantId?: string; newName?: string; token: string };
  // 주최자 동기화 기준은 참석자 전용 기록에는 두지 않는다.
  lastRev?: number;
  docRev?: number;
  syncedDoc?: MeetingDoc;
  // 이 기기가 마지막으로 받은 각 참석자의 답장 출발지다.
  replyOrigins?: Record<string, Origin>;
  seen?: string[];
  seenNames?: Record<string, string>;
  ended?: true;
};
const nonempty = Schema.String.check(Schema.isMinLength(1));
const generatedToken = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/));
const recordSchema = Schema.Struct({
  hostToken: Schema.optionalKey(nonempty),
  pendingHostToken: Schema.optionalKey(generatedToken),
  hostLikes: Schema.optionalKey(
    Schema.mutable(Schema.Array(MeetingMemberId)).check(
      Schema.isMaxLength(LIBRARY_LIMITS.meetingCandidatesMax),
    ),
  ),
  guest: Schema.optionalKey(Schema.Struct({ participantId: MeetingMemberId, token: nonempty })),
  pendingGuest: Schema.optionalKey(
    Schema.Struct({
      participantId: Schema.optionalKey(MeetingMemberId),
      newName: Schema.optionalKey(MeetingName),
      token: generatedToken,
    }).check(
      Schema.makeFilter(
        (pending) => (pending.participantId !== undefined) !== (pending.newName !== undefined),
        { message: '참석자나 새 이름 중 하나를 골라야 합니다' },
      ),
    ),
  ),
  hostLikesAckRev: Schema.optionalKey(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  ),
  lastRev: Schema.optionalKey(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  docRev: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
  syncedDoc: Schema.optionalKey(MeetingDocSchema),
  replyOrigins: Schema.optionalKey(
    Schema.Record(Schema.String, OriginSchema).check(
      Schema.makeFilter(
        (origins) =>
          Object.keys(origins).length <= LIBRARY_LIMITS.meetingParticipantsMax &&
          Object.keys(origins).every(Schema.is(MeetingMemberId)),
        { message: '답장 출발지의 참석자 id나 개수가 올바르지 않습니다' },
      ),
    ),
  ),
  seen: Schema.optionalKey(
    Schema.mutable(Schema.Array(MeetingMemberId)).check(
      Schema.isMaxLength(LIBRARY_LIMITS.meetingParticipantsMax),
    ),
  ),
  seenNames: Schema.optionalKey(
    Schema.Record(Schema.String, MeetingName).check(
      Schema.makeFilter(
        (names) =>
          Object.keys(names).length <= LIBRARY_LIMITS.meetingParticipantsMax &&
          Object.keys(names).every(Schema.is(MeetingMemberId)),
        { message: '답장 참석자 이름의 id나 개수가 올바르지 않습니다' },
      ),
    ),
  ),
  ended: Schema.optionalKey(Schema.Literal(true)),
});

/** 보관함·백업과 따로 저장한다. 저장소가 막히면 이번 페이지에서는 메모리만 쓴다. */
export function createOnlineStore(storage: () => Storage = () => window.localStorage) {
  let memory = new Map<string, OnlineRecord>();
  let memoryOnly = false;
  const listeners = new Map<string, Set<(record: OnlineRecord | null) => void>>();
  const allListeners = new Set<() => void>();
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
    for (const [id, record] of memory) {
      if (memory.size <= 200) break;
      if (
        record.ended ||
        (!record.hostToken && !record.guest && !record.pendingGuest && !record.pendingHostToken)
      )
        memory.delete(id);
    }
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
  function notify(id: string) {
    for (const listener of listeners.get(id) ?? []) listener(readOnline(id));
    for (const listener of allListeners) listener();
  }
  /** 목록은 약속 수와 무관하게 한 번만 구독하고 전체 스냅숏을 다시 읽는다. */
  function subscribeAllOnline(listener: () => void) {
    allListeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key === MEET_ONLINE_KEY || event.key === null) listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      allListeners.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  }
  function subscribeOnline(id: string, listener: (record: OnlineRecord | null) => void) {
    const group = listeners.get(id) ?? new Set();
    group.add(listener);
    listeners.set(id, group);
    const onStorage = (event: StorageEvent) => {
      if (event.key === MEET_ONLINE_KEY || event.key === null) listener(readOnline(id));
    };
    window.addEventListener('storage', onStorage);
    return () => {
      group.delete(listener);
      if (group.size === 0) listeners.delete(id);
      window.removeEventListener('storage', onStorage);
    };
  }
  /** 읽기·비교·쓰기를 한 동기 경로에 모아 늦은 응답이 최신 기록을 덮지 않게 한다. */
  function updateOnline(
    id: string,
    update: (current: OnlineRecord | null) => OnlineRecord | null,
  ): OnlineRecord | null {
    const current = readOnline(id);
    const next = update(current);
    if (next === current) return current;
    // 다시 쓴 기록을 마지막으로 옮겨 오래된 기록부터 버린다.
    memory.delete(id);
    if (next !== null) memory.set(id, structuredClone(next));
    trim();
    save();
    notify(id);
    // 구독자가 이어 쓴 값까지 화면에 돌려준다.
    return readOnline(id);
  }
  function writeOnline(id: string, record: OnlineRecord): void {
    updateOnline(id, () => record);
  }
  function removeOnline(id: string): void {
    read();
    memory.delete(id);
    save();
    notify(id);
  }
  return {
    allOnline,
    readOnline,
    updateOnline,
    writeOnline,
    removeOnline,
    subscribeOnline,
    subscribeAllOnline,
  };
}

export const {
  allOnline,
  readOnline,
  updateOnline,
  writeOnline,
  removeOnline,
  subscribeOnline,
  subscribeAllOnline,
} = createOnlineStore();

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

/** 요청 뒤 주최자 연결이나 복구 작업이 바뀌었으면 이전 응답은 쓰지 않는다. */
export function sameHostConnection(current: OnlineRecord | null, expected: OnlineRecord | null) {
  return (
    current?.hostToken === expected?.hostToken &&
    current?.pendingHostToken === expected?.pendingHostToken &&
    current?.ended === expected?.ended
  );
}

/** 원격 본문을 요청할 때의 합치기 기준이 그대로인지 확인한다. */
export function sameOnlineSync(current: OnlineRecord | null, expected: OnlineRecord | null) {
  const fields = ['lastRev', 'docRev', 'syncedDoc', 'replyOrigins', 'seen', 'seenNames'] as const;
  return (
    sameHostConnection(current, expected) &&
    fields.every((field) => JSON.stringify(current?.[field]) === JSON.stringify(expected?.[field]))
  );
}
