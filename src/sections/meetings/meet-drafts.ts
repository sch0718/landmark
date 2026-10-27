import { Schema } from 'effect';
import { ReplyInputSchema } from 'src/domain/meeting/online-doc';
import { MeetingId, MeetingMemberId, MeetingName, OriginSchema } from 'src/schema/meeting';
import { safeParse } from 'src/schema/parse';

export const MEET_DRAFTS_KEY = 'tripmap:meet-drafts:v1';
const DraftSchema = Schema.Struct({
  participantId: Schema.optionalKey(MeetingMemberId),
  newName: Schema.optionalKey(MeetingName),
  origin: Schema.optionalKey(Schema.NullOr(OriginSchema)),
  likes: Schema.Array(MeetingMemberId).check(Schema.isMaxLength(8)),
  times: ReplyInputSchema.fields.times,
  docRev: ReplyInputSchema.fields.docRev,
}).check(
  Schema.makeFilter(
    (draft) =>
      (draft.participantId === undefined) !== (draft.newName === undefined) &&
      new Set(draft.likes).size === draft.likes.length,
    { message: '답장 신원과 좋아요를 확인해 주세요' },
  ),
);
export type MeetDraft = typeof DraftSchema.Type;
const EntrySchema = Schema.Struct({
  meetingId: MeetingId,
  draft: DraftSchema,
  version: Schema.optionalKey(Schema.String),
});
export type MeetDraftEntry = { draft: MeetDraft; version: string | null };
type Entry = typeof EntrySchema.Type;

/** 디스크 값은 믿지 않고 항목마다 엄격히 검증한다. 배열 끝이 최근에 쓴 항목이다. */
function readEntries(storage: Storage): Entry[] {
  const text = storage.getItem(MEET_DRAFTS_KEY);
  if (text === null || text.length > 100_000) return [];
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || !('drafts' in raw) || !Array.isArray(raw.drafts))
    return [];
  const entries = new Map<string, Entry>();
  for (const item of raw.drafts) {
    const parsed = safeParse(EntrySchema, item, { onExcessProperty: 'error' });
    if (!parsed.success) continue;
    entries.delete(parsed.data.meetingId);
    entries.set(parsed.data.meetingId, parsed.data);
  }
  return [...entries.values()].slice(-20);
}

/** 저장소가 차거나 차단돼도 화면에서는 초안을 계속 쓴다. */
export function saveMeetDraft(
  meetingId: string,
  draft: MeetDraft,
  storage?: Storage,
  expectedVersion?: string | null,
): string | null | undefined {
  let storedVersion: string | null = null;
  const version = crypto.randomUUID();
  try {
    const parsed = safeParse(
      EntrySchema,
      { meetingId, draft, version },
      { onExcessProperty: 'error' },
    );
    if (!parsed.success) return undefined;
    const target = storage ?? window.localStorage;
    let before: Entry[];
    try {
      before = readEntries(target);
    } catch {
      before = [];
    }
    const current = before.find((entry) => entry.meetingId === meetingId);
    storedVersion = entryVersion(current);
    if (expectedVersion !== undefined && storedVersion !== expectedVersion) return undefined;
    const entries = [...before.filter((entry) => entry.meetingId !== meetingId), parsed.data].slice(
      -20,
    );
    target.setItem(MEET_DRAFTS_KEY, JSON.stringify({ drafts: entries }));
  } catch {
    // 쓰지 못한 새 버전 대신 디스크 기준을 돌려줘 현재 입력으로 계속 재시도한다.
    return storedVersion;
  }
  return version;
}

function entryVersion(entry: Entry | undefined): string | null {
  // 버전이 없던 초안도 내용 기준으로 비교하고 다음 편집부터 새 버전을 쓴다.
  return entry ? (entry.version ?? JSON.stringify(entry.draft)) : null;
}

/** 읽기는 최근 순서만 옮기며 전송 중인 초안의 버전을 바꾸지 않는다. */
export function loadMeetDraftEntry(meetingId: string, storage?: Storage): MeetDraftEntry | null {
  try {
    const target = storage ?? window.localStorage;
    const entries = readEntries(target);
    const entry = entries.find((item) => item.meetingId === meetingId);
    if (entry === undefined) return null;
    try {
      target.setItem(
        MEET_DRAFTS_KEY,
        JSON.stringify({
          drafts: [...entries.filter((item) => item.meetingId !== meetingId), entry],
        }),
      );
    } catch {
      /* 읽은 초안은 쓰기 실패와 무관하게 돌려준다. */
    }
    return { draft: entry.draft, version: entryVersion(entry)! };
  } catch {
    return null;
  }
}

export function loadMeetDraft(meetingId: string, storage?: Storage): MeetDraft | null {
  return loadMeetDraftEntry(meetingId, storage)?.draft ?? null;
}

/** 이 요청이 보낸 버전일 때만 지워 다른 탭의 새 초안을 지킨다. */
export function removeMeetDraft(
  meetingId: string,
  expectedVersion: string | null,
  storage?: Storage,
): boolean {
  try {
    const target = storage ?? window.localStorage;
    const entries = readEntries(target);
    if (entryVersion(entries.find((entry) => entry.meetingId === meetingId)) !== expectedVersion)
      return false;
    target.setItem(
      MEET_DRAFTS_KEY,
      JSON.stringify({
        drafts: entries.filter((entry) => entry.meetingId !== meetingId),
      }),
    );
  } catch {
    /* 저장소가 막혀도 이번 화면의 저장 결과는 유지한다. */
  }
  return true;
}
