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
const EntrySchema = Schema.Struct({ meetingId: MeetingId, draft: DraftSchema });
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
export function saveMeetDraft(meetingId: string, draft: MeetDraft, storage?: Storage): void {
  try {
    const parsed = safeParse(EntrySchema, { meetingId, draft }, { onExcessProperty: 'error' });
    if (!parsed.success) return;
    const target = storage ?? window.localStorage;
    let before: Entry[];
    try {
      before = readEntries(target);
    } catch {
      before = [];
    }
    const entries = [...before.filter((entry) => entry.meetingId !== meetingId), parsed.data].slice(
      -20,
    );
    target.setItem(MEET_DRAFTS_KEY, JSON.stringify({ drafts: entries }));
  } catch {
    /* 저장 실패는 편의 기능에만 영향을 준다. */
  }
}

/** 읽은 항목은 최근 항목으로 옮긴다. 쓰기 실패여도 읽은 초안은 돌려준다. */
export function loadMeetDraft(meetingId: string, storage?: Storage): MeetDraft | null {
  try {
    const target = storage ?? window.localStorage;
    const entry = readEntries(target).find((item) => item.meetingId === meetingId);
    if (entry === undefined) return null;
    saveMeetDraft(meetingId, entry.draft, target);
    return entry.draft;
  } catch {
    return null;
  }
}

/** 서버에 도착한 초안은 지워 다음 방문에 예전 답장을 다시 보내지 않는다. */
export function removeMeetDraft(meetingId: string, storage?: Storage): void {
  try {
    const target = storage ?? window.localStorage;
    target.setItem(
      MEET_DRAFTS_KEY,
      JSON.stringify({
        drafts: readEntries(target).filter((entry) => entry.meetingId !== meetingId),
      }),
    );
  } catch {
    /* 저장소가 막혀도 이번 화면의 저장 결과는 유지한다. */
  }
}
