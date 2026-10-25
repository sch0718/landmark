import { describe, expect, it } from 'vitest';
import { docFromMeeting, type OnlineReply, type OnlineState } from 'src/domain/meeting/online-doc';
import { mergeOnline } from 'src/domain/meeting/online-merge';
import { emptyLibrary, LibrarySchema, type Library } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { buildMeeting } from '../../../fixtures/builders';

const base = buildMeeting();
const origin = { name: '집', lng: 127, lat: 37.5 };
const meeting = buildMeeting({
  participants: {
    ...base.participants,
    value: [
      { id: 'host0001', name: '나', origin },
      { id: 'person01', name: '친구', origin },
    ],
  },
});
const now = '2026-10-26T00:00:00.000Z';
const updatedAt = '2026-10-25T00:00:00.000Z';
const ctx = {
  now,
  newId: () => {
    throw new Error('서버 참석자 id를 그대로 써야 합니다');
  },
};
const library = (m = meeting): Library => ({ ...emptyLibrary(), meetings: { [m.id]: m } });
const reply = (patch: Partial<OnlineReply> = {}): OnlineReply => ({
  participantId: 'person01',
  name: '친구',
  origin: null,
  likes: ['choice01'],
  times: null,
  updatedAt,
  ...patch,
});
const state = (
  replies: readonly OnlineReply[] = [reply()],
  decided: string | null = null,
): OnlineState => ({
  rev: 1,
  docRev: 1,
  doc: { ...docFromMeeting(meeting, {}, 'min'), decided },
  replies,
});
const merge = (lib: Library, online = state(), syncedAt: string | null = now) => {
  const original = JSON.stringify(lib);
  const result = mergeOnline(lib, meeting.id, online, ctx, syncedAt);
  expect(JSON.stringify(lib)).toBe(original);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result));
  expect(safeParse(LibrarySchema, result.lib).success).toBe(true);
  return result.lib;
};
const mergedMeeting = (lib: Library) => lib.meetings![meeting.id]!;

describe('온라인 상태를 보관한 약속에 합친다', () => {
  it('없는 약속과 삭제된 약속은 not-found', () => {
    for (const lib of [emptyLibrary(), library({ ...meeting, deletedAt: now })]) {
      expect(mergeOnline(lib, meeting.id, state(), ctx, now)).toEqual({
        ok: false,
        error: { _tag: 'MeetingOpError', reason: 'not-found' },
      });
    }
  });

  it('새 참석자를 서버의 id·이름·출발지로 더한다', () => {
    const next = mergedMeeting(
      merge(library(), state([reply({ participantId: 'new00001', name: '새 친구', origin })])),
    );
    expect(next.participants.value[2]).toEqual({ id: 'new00001', name: '새 친구', origin });
    expect(next.participants.updatedAt).toBe(now);
    expect(next.replies.value.new00001).toEqual({
      likes: ['choice01'],
      sentAt: updatedAt,
      receivedAt: now,
    });
  });

  it('11번째 참석자 답장은 건너뛰고 기존 참석자 답장은 반영한다', () => {
    const full = {
      ...meeting,
      participants: {
        ...meeting.participants,
        value: [
          ...meeting.participants.value,
          ...Array.from({ length: 8 }, (_, i) => ({
            id: String(i).padStart(8, '0'),
            name: `친구${i}`,
            origin: null,
          })),
        ],
      },
    };
    const next = mergedMeeting(
      merge(library(full), state([reply({ participantId: 'new00001' }), reply()])),
    );
    expect(next.participants).toBe(full.participants);
    expect(next.replies.value.new00001).toBeUndefined();
    expect(next.replies.value.person01?.likes).toEqual(['choice01']);
  });

  it('같은 이름이어도 id가 다르면 새 참석자이다', () => {
    const next = mergedMeeting(merge(library(), state([reply({ participantId: 'new00001' })])));
    expect(next.participants.value.map((p) => p.id)).toEqual(['host0001', 'person01', 'new00001']);
  });

  it('새 답장의 출발지를 반영하고 지금 후보만 좋아요에 남긴다', () => {
    const changed = { name: '회사', lng: 128, lat: 38 };
    const next = mergedMeeting(
      merge(library(), state([reply({ origin: changed, likes: ['choice01', 'deleted1'] })])),
    );
    expect(next.participants.value[1]?.origin).toEqual(changed);
    expect(next.participants.updatedAt).toBe(now);
    expect(next.replies.value.person01).toEqual({
      likes: ['choice01'],
      sentAt: updatedAt,
      receivedAt: now,
    });
    expect(next.replies.updatedAt).toBe(now);
    expect(next.title).toBe(meeting.title);
    expect(next.candidates).toBe(meeting.candidates);
  });

  it('null 출발지는 기존 값을 유지한다', () => {
    const next = mergedMeeting(merge(library()));
    expect(next.participants).toBe(meeting.participants);
  });

  it('같은 갱신 시각을 다시 합치면 보관함과 필드 시각이 그대로다', () => {
    const first = merge(library(), state([reply({ origin: { name: '회사', lng: 128, lat: 38 } })]));
    const result = mergeOnline(
      first,
      meeting.id,
      state([reply({ origin, likes: [] })]),
      { ...ctx, now: '2026-10-27T00:00:00.000Z' },
      now,
    );
    expect(result).toEqual({ ok: true, lib: first });
    if (result.ok) expect(result.lib).toBe(first);
  });

  it('더 오래된 답장은 출발지까지 모두 무시한다', () => {
    const first = merge(library());
    expect(
      merge(
        first,
        state([
          reply({
            updatedAt: meeting.createdAt,
            origin: { name: '옛집', lng: 128, lat: 38 },
            likes: [],
          }),
        ]),
      ),
    ).toBe(first);
  });

  it('주최자 답장은 출발지·좋아요를 모두 무시한다', () => {
    const lib = library();
    expect(
      merge(
        lib,
        state([
          reply({
            participantId: 'host0001',
            origin: { name: '다른 집', lng: 128, lat: 38 },
            likes: [],
          }),
        ]),
      ),
    ).toBe(lib);
  });

  it.each([null, 'choice01'])('서버 확정 %s를 다른 기기에 반영한다', (decided) => {
    const current = {
      ...meeting,
      decided: { value: decided === null ? 'choice01' : null, updatedAt },
    };
    const next = mergedMeeting(merge(library(current), state([], decided)));
    expect(next.decided).toEqual({ value: decided, updatedAt: now });
  });

  it.each([null, 'choice01'])('마지막 동기화 뒤 바꾼 확정 %s는 서버가 덮지 못한다', (decided) => {
    const current = {
      ...meeting,
      decided: { value: decided, updatedAt: '2026-10-25T23:59:59.000Z' },
    };
    const lib = library(current);
    expect(merge(lib, state([], decided === null ? 'choice01' : null), updatedAt)).toBe(lib);
  });

  it('마지막 동기화 이전 확정은 다른 주최자 기기의 확정으로 바꾼다', () => {
    const current = {
      ...meeting,
      candidates: {
        ...meeting.candidates,
        value: [...meeting.candidates.value, { ...meeting.candidates.value[0]!, id: 'choice02' }],
      },
      decided: { value: 'choice01', updatedAt },
    };
    const next = mergedMeeting(merge(library(current), state([], 'choice02'), now));
    expect(next.decided).toEqual({ value: 'choice02', updatedAt: now });
  });

  it('확정 시각이 마지막 동기화와 같으면 서버 확정을 반영한다', () => {
    const current = { ...meeting, decided: { value: 'choice01', updatedAt } };
    const next = mergedMeeting(merge(library(current), state([]), updatedAt));
    expect(next.decided).toEqual({ value: null, updatedAt: now });
  });

  it.each([null, 'choice01'])(
    '처음 담는 기기는 로컬 시각과 무관하게 서버 확정 %s를 쓴다',
    (decided) => {
      const current = {
        ...meeting,
        decided: {
          value: decided === null ? 'choice01' : null,
          updatedAt: '2026-10-27T00:00:00.000Z',
        },
      };
      const next = mergedMeeting(merge(library(current), state([], decided), null));
      expect(next.decided).toEqual({ value: decided, updatedAt: now });
    },
  );

  it.each([null, 'choice01'])('확정 %s가 같으면 시각과 객체를 바꾸지 않는다', (decided) => {
    const current = { ...meeting, decided: { value: decided, updatedAt } };
    const lib = library(current);
    for (const syncedAt of [null, meeting.createdAt, now]) {
      const next = merge(lib, state([], decided), syncedAt);
      expect(next).toBe(lib);
      expect(mergedMeeting(next)).toBe(current);
      expect(mergedMeeting(next).decided).toBe(current.decided);
    }
  });

  it('서버 본문의 제목·참석자 출발지·후보는 로컬 본문을 바꾸지 않는다', () => {
    const current = state([]);
    const online = {
      ...current,
      doc: {
        ...current.doc,
        title: '다른 기기 제목',
        participants: [],
        candidates: [],
        times: {},
      },
    };
    const lib = library();
    expect(merge(lib, online)).toBe(lib);
  });
});
