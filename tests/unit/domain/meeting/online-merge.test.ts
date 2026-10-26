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
const merge = (
  lib: Library,
  online = state(),
  syncedAt: string | null = now,
  docRev: number | null = 1,
) => {
  const original = JSON.stringify(lib);
  const result = mergeOnline(lib, meeting.id, online, ctx, {
    syncedAt,
    docRev,
    hostLikes: null,
    seen: [],
  });
  expect(JSON.stringify(lib)).toBe(original);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result));
  expect(safeParse(LibrarySchema, result.lib).success).toBe(true);
  return result.lib;
};
const mergedMeeting = (lib: Library) => lib.meetings![meeting.id]!;

it.each([
  { local: [], baseline: [], remote: ['choice01'], expected: ['choice01'] },
  { local: ['choice01'], baseline: ['choice01'], remote: [], expected: [] },
  { local: ['choice01'], baseline: [], remote: [], expected: ['choice01'] },
  { local: [], baseline: null, remote: ['choice01'], expected: [] },
])('주최자 좋아요는 마지막 동기화 기록과 비교한다: %j', ({ local, baseline, remote, expected }) => {
  const current = {
    ...meeting,
    replies: {
      value: { host0001: { likes: local, sentAt: updatedAt, receivedAt: updatedAt } },
      updatedAt,
    },
  };
  const result = mergeOnline(
    library(current),
    meeting.id,
    state([reply({ participantId: 'host0001', likes: remote })]),
    ctx,
    { syncedAt: now, docRev: 1, seen: [], hostLikes: baseline },
  );
  expect(result.ok).toBe(true);
  if (result.ok) expect(mergedMeeting(result.lib).replies.value.host0001?.likes).toEqual(expected);
});

describe('온라인 상태를 보관한 약속에 합친다', () => {
  it('없는 약속과 삭제된 약속은 not-found', () => {
    for (const lib of [emptyLibrary(), library({ ...meeting, deletedAt: now })]) {
      expect(
        mergeOnline(lib, meeting.id, state(), ctx, {
          syncedAt: now,
          docRev: 1,
          hostLikes: null,
          seen: [],
        }),
      ).toEqual({
        ok: false,
        error: { _tag: 'MeetingOpError', reason: 'not-found' },
      });
    }
  });

  it('서버 본문에 없는 답장 전용 참석자를 서버의 id·이름·출발지로 더한다', () => {
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

  it('서버 본문에 남아 있어도 이 기기에서 지운 참석자와 답장은 되살리지 않는다', () => {
    const local = {
      ...meeting,
      participants: { ...meeting.participants, value: meeting.participants.value.slice(0, 1) },
    };
    const next = mergedMeeting(merge(library(local), state([reply({ origin })])));
    expect(next.participants).toBe(local.participants);
    expect(next.replies.value.person01).toBeUndefined();
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
      { syncedAt: now, docRev: 1, hostLikes: null, seen: [] },
    );
    expect(result).toEqual({ ok: true, lib: first, addedReplyOnly: [] });
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

  it('기존 주최자 답장은 출발지·좋아요를 모두 무시한다', () => {
    const lib = library({
      ...meeting,
      replies: {
        value: { host0001: { likes: ['choice01'], sentAt: updatedAt, receivedAt: updatedAt } },
        updatedAt,
      },
    });
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
    const next = mergedMeeting(merge(library(current), state([], decided), now, null));
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
    const initial = state([], 'choice02');
    const remote = { ...initial, doc: { ...initial.doc, candidates: current.candidates.value } };
    const next = mergedMeeting(merge(library(current), remote, now, null));
    expect(next.decided).toEqual({ value: 'choice02', updatedAt: now });
  });

  it('확정 시각이 마지막 동기화와 같으면 서버 확정을 반영한다', () => {
    const current = { ...meeting, decided: { value: 'choice01', updatedAt } };
    const next = mergedMeeting(merge(library(current), state([]), updatedAt, null));
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
      const next = mergedMeeting(merge(library(current), state([], decided), null, null));
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

it('원격 후보 추가와 확정, 새 답장을 한 번에 반영한다', () => {
  const candidate = { ...meeting.candidates.value[0]!, id: 'choice02' };
  const initial = state([reply({ participantId: 'new00001', likes: ['choice02'] })], 'choice02');
  const remote = {
    ...initial,
    doc: {
      ...initial.doc,
      title: '새 제목',
      candidates: [...initial.doc.candidates, candidate],
    },
  };
  const result = mergeOnline(library(), meeting.id, remote, ctx, {
    syncedAt: now,
    docRev: null,
    hostLikes: null,
    seen: [],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const next = mergedMeeting(result.lib);
  expect(next.title.value).toBe('새 제목');
  expect(next.candidates.value).toContainEqual(candidate);
  expect(next.decided.value).toBe('choice02');
  expect(next.replies.value.new00001?.likes).toEqual(['choice02']);
});

it.each(['title', 'at', 'mode', 'participants', 'candidates', 'decided'] as const)(
  '미전송 %s 수정이 있으면 원격 본문 전체를 받지 않는다',
  (key) => {
    const local = { ...meeting, [key]: { ...meeting[key], updatedAt: now } };
    const initial = state([], 'choice01');
    const remote = { ...initial, doc: { ...initial.doc, title: '원격 제목' } };
    const result = mergeOnline(library(local), meeting.id, remote, ctx, {
      hostLikes: null,
      seen: [],
      syncedAt: updatedAt,
      docRev: null,
    });
    expect(result).toEqual({ ok: true, lib: library(local), addedReplyOnly: [] });
  },
);

it('지금 후보에 없는 확정과 기존 답장 좋아요를 저장 전에 걸러낸다', () => {
  const local = {
    ...meeting,
    decided: { value: 'deleted1', updatedAt },
    replies: {
      value: {
        person01: { likes: ['choice01', 'deleted1'], sentAt: updatedAt, receivedAt: updatedAt },
      },
      updatedAt,
    },
  };
  const result = mergeOnline(library(local), meeting.id, state([]), ctx, {
    hostLikes: null,
    seen: [],
    syncedAt: now,
    docRev: 1,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(mergedMeeting(result.lib).decided.value).toBeNull();
  expect(mergedMeeting(result.lib).replies.value.person01?.likes).toEqual(['choice01']);
});

it('주최자 답장이 없을 때만 서버 좋아요를 처음 복원한다', () => {
  const remote = state([
    reply({
      participantId: 'host0001',
      likes: ['choice01', 'deleted1'],
      origin: { name: '다른 집', lng: 128, lat: 38 },
    }),
  ]);
  const first = merge(library(), remote);
  expect(mergedMeeting(first).replies.value.host0001).toEqual({
    likes: ['choice01'],
    sentAt: updatedAt,
    receivedAt: now,
  });
  expect(mergedMeeting(first).participants.value[0]?.origin).toEqual(origin);
  const later = state([reply({ participantId: 'host0001', likes: [], updatedAt: now })]);
  expect(merge(first, later)).toBe(first);
});

it('서버 본문을 받을 때 이미 받은 답장 전용 참석자도 보존한다', () => {
  const remote = state([reply({ participantId: 'new00001', origin })]);
  const first = merge(library(), remote);
  const result = mergeOnline(first, meeting.id, { ...remote, docRev: 2 }, ctx, {
    hostLikes: null,
    seen: ['new00001'],
    syncedAt: now,
    docRev: 1,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(mergedMeeting(result.lib).participants.value).toContainEqual({
    id: 'new00001',
    name: '친구',
    origin,
  });
  expect(mergedMeeting(result.lib).replies.value.new00001?.likes).toEqual(['choice01']);
});

it('이미 합친 뒤 지운 답장 전용 참석자와 답장을 되살리지 않는다', () => {
  const lib = library();
  const result = mergeOnline(lib, meeting.id, state([reply({ participantId: 'new00001' })]), ctx, {
    syncedAt: now,
    docRev: 1,
    hostLikes: null,
    seen: ['new00001'],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.lib).toBe(lib);
  expect(result.addedReplyOnly).toEqual([]);
});

it('처음 보는 답장 전용 참석자를 더하고 id를 결과로 알린다', () => {
  const result = mergeOnline(
    library(),
    meeting.id,
    state([reply({ participantId: 'new00001' })]),
    ctx,
    {
      syncedAt: now,
      docRev: 1,
      hostLikes: null,
      seen: [],
    },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(mergedMeeting(result.lib).participants.value.some((p) => p.id === 'new00001')).toBe(true);
  expect(result.addedReplyOnly).toEqual(['new00001']);
});
