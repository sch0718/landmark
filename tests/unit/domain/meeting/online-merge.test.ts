import { describe, expect, it } from 'vitest';
import {
  docFromMeeting,
  type MeetingDoc,
  type OnlineReply,
  type OnlineState,
} from 'src/domain/meeting/online-doc';
import { hostEdits, mergeOnline } from 'src/domain/meeting/online-merge';
import { emptyLibrary, LibrarySchema, type Library } from 'src/schema/library';
import type { Origin } from 'src/schema/meeting';
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
  syncedDoc: MeetingDoc | null = docFromMeeting(meeting, {}, 'min'),
  docRev: number | null = 1,
  replyOrigins?: Record<string, Origin>,
) => {
  const original = JSON.stringify(lib);
  const result = mergeOnline(lib, meeting.id, online, ctx, {
    syncedDoc,
    docRev,
    replyOrigins,
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

it.each([false, true])(
  '주최자 출발지는 같은 답장의 좋아요만 바뀌면 유지하고 새 출발지는 받는다: %s',
  (newOrigin) => {
    const seenOrigin = { name: '친구 집 B', lng: 128, lat: 38 };
    const hostOrigin = { name: '주최자 집 C', lng: 127.5, lat: 37.6 };
    const nextOrigin = { name: '친구 집 D', lng: 126.5, lat: 37.2 };
    const first = mergedMeeting(merge(library(), state([reply({ origin: seenOrigin })])));
    const local = {
      ...first,
      participants: {
        ...first.participants,
        value: first.participants.value.map((p) =>
          p.id === 'person01' ? { ...p, origin: hostOrigin } : p,
        ),
      },
    };
    const result = mergeOnline(
      library(local),
      meeting.id,
      state([
        reply({
          origin: newOrigin ? nextOrigin : seenOrigin,
          likes: [],
          updatedAt: now,
        }),
      ]),
      ctx,
      {
        syncedDoc: docFromMeeting(meeting, {}, 'min'),
        docRev: 1,
        seen: [],
        hostLikes: null,
        replyOrigins: { person01: seenOrigin },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mergedMeeting(result.lib).participants.value[1]?.origin).toEqual(
      newOrigin ? nextOrigin : hostOrigin,
    );
    expect(mergedMeeting(result.lib).replies.value.person01?.likes).toEqual([]);
    expect(result.replyOrigins).toEqual({ person01: newOrigin ? nextOrigin : seenOrigin });
  },
);

it('본문을 받을 때도 같은 출발지의 새 좋아요 답장으로 원격 출발지를 덮지 않는다', () => {
  const seenOrigin = { name: '친구 집 B', lng: 128, lat: 38 };
  const remoteOrigin = { name: '다른 기기 집 C', lng: 127.5, lat: 37.6 };
  const first = merge(library(), state([reply({ origin: seenOrigin })]));
  const remote = state([reply({ origin: seenOrigin, likes: [], updatedAt: now })]);
  const next = mergedMeeting(
    merge(
      first,
      {
        ...remote,
        docRev: 2,
        doc: {
          ...remote.doc,
          participants: remote.doc.participants.map((p) =>
            p.id === 'person01' ? { ...p, origin: remoteOrigin } : p,
          ),
        },
      },
      remote.doc,
      1,
      { person01: seenOrigin },
    ),
  );
  expect(next.participants.value[1]?.origin).toEqual(remoteOrigin);
  expect(next.replies.value.person01?.likes).toEqual([]);
});

it('본문 출발지로 되돌려도 마지막으로 본 답장 출발지를 덮어쓰면 주최자 수정이다', () => {
  expect(
    hostEdits(meeting, docFromMeeting(meeting, {}, 'min'), [], {
      person01: { name: '친구 집 B', lng: 128, lat: 38 },
    }),
  ).toBe(true);
});

it('보관함보다 작은 답장 시각도 다르면 서버 좋아요와 출발지로 갱신한다', () => {
  const local = {
    ...meeting,
    replies: {
      value: { person01: { likes: ['choice01'], sentAt: now, receivedAt: now } },
      updatedAt: now,
    },
  };
  const changed = { name: '새 집', lng: 128, lat: 38 };
  const next = mergedMeeting(merge(library(local), state([reply({ origin: changed, likes: [] })])));
  expect(next.replies.value.person01).toEqual({ likes: [], sentAt: updatedAt, receivedAt: now });
  expect(next.participants.value[1]?.origin).toEqual(changed);
});

it('친구 출발지를 합친 뒤에도 다른 주최자 기기의 확정을 받는다', () => {
  const syncedDoc = docFromMeeting(meeting, {}, 'min');
  const changed = { name: '회사', lng: 128, lat: 38 };
  const first = merge(library(), state([reply({ origin: changed })]));
  const result = mergeOnline(
    first,
    meeting.id,
    { ...state([reply({ origin: changed })], 'choice01'), docRev: 2 },
    ctx,
    {
      syncedDoc,
      docRev: 1,
      seen: [],
      hostLikes: null,
      replyOrigins: { person01: changed },
    },
  );
  expect(result.ok).toBe(true);
  if (result.ok) expect(mergedMeeting(result.lib).decided.value).toBe('choice01');
});

it.each([
  {
    pid: 'host0001',
    changed: { name: '회사', lng: 128, lat: 38 },
    replyOrigin: { name: '회사', lng: 128, lat: 38 },
  },
  { pid: 'host0001', changed: null, replyOrigin: null },
  { pid: 'person01', changed: { name: '회사', lng: 128, lat: 38 }, replyOrigin: origin },
  { pid: 'person01', changed: null, replyOrigin: null },
])('미전송 출발지 수정은 원격 제목을 받아도 보존한다: %j', ({ pid, changed, replyOrigin }) => {
  const remoteReply = reply({ participantId: pid, origin: replyOrigin });
  const local = {
    ...meeting,
    participants: {
      value: meeting.participants.value.map((p) => (p.id === pid ? { ...p, origin: changed } : p)),
      updatedAt: now,
    },
    replies: {
      value: { [pid]: { likes: ['choice01'], sentAt: updatedAt, receivedAt: updatedAt } },
      updatedAt,
    },
  };
  const remote = state([remoteReply]);
  const next = mergedMeeting(
    merge(
      library(local),
      {
        ...remote,
        docRev: 2,
        doc: { ...remote.doc, title: '다른 기기 제목' },
      },
      remote.doc,
      1,
      replyOrigin === null ? {} : { [pid]: replyOrigin },
    ),
  );
  expect(next.participants.value.find((p) => p.id === pid)?.origin).toEqual(changed);
  expect(next.title.value).toBe(meeting.title.value);
});

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
    { syncedDoc: docFromMeeting(meeting, {}, 'min'), docRev: 1, seen: [], hostLikes: baseline },
  );
  expect(result.ok).toBe(true);
  if (result.ok) expect(mergedMeeting(result.lib).replies.value.host0001?.likes).toEqual(expected);
});

describe('온라인 상태를 보관한 약속에 합친다', () => {
  it('없는 약속과 삭제된 약속은 not-found', () => {
    for (const lib of [emptyLibrary(), library({ ...meeting, deletedAt: now })]) {
      expect(
        mergeOnline(lib, meeting.id, state(), ctx, {
          syncedDoc: docFromMeeting(meeting, {}, 'min'),
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

  it('같은 갱신 시각이어도 새 출발지는 반영하고 좋아요와 답장 필드 시각은 유지한다', () => {
    const first = merge(library(), state([reply({ origin: { name: '회사', lng: 128, lat: 38 } })]));
    const result = mergeOnline(
      first,
      meeting.id,
      state([reply({ origin, likes: [] })]),
      { ...ctx, now: '2026-10-27T00:00:00.000Z' },
      { syncedDoc: docFromMeeting(meeting, {}, 'min'), docRev: 1, hostLikes: null, seen: [] },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(mergedMeeting(result.lib).participants.value[1]?.origin).toEqual(origin);
      expect(mergedMeeting(result.lib).replies).toBe(mergedMeeting(first).replies);
      expect(result.replyOrigins).toEqual({ person01: origin });
    }
  });

  it('서버 본문을 받으면 이미 본 같은 답장 출발지는 다시 적용하지 않는다', () => {
    const changed = { name: '회사', lng: 128, lat: 38 };
    const remote = state([reply({ origin: changed })]);
    const first = merge(library(), remote);
    expect(mergedMeeting(first).participants.value[1]?.origin).toEqual(changed);

    const next = mergedMeeting(
      merge(first, { ...remote, docRev: 2 }, remote.doc, 1, { person01: changed }),
    );
    expect(next.participants.value[1]?.origin).toEqual(origin);
    expect(next.replies.value.person01).toEqual(mergedMeeting(first).replies.value.person01);
  });

  it.each([{ name: '주최자가 고친 집', lng: 127.5, lat: 37.6 }, null])(
    '다른 기기 본문에서 고친 출발지 %j를 이미 합친 옛 답장으로 되돌리지 않는다',
    (changed) => {
      const remote = state([reply({ origin: { name: '친구 집', lng: 128, lat: 38 } })]);
      const first = merge(library(), remote);
      const next = mergedMeeting(
        merge(
          first,
          {
            ...remote,
            rev: 2,
            docRev: 2,
            doc: {
              ...remote.doc,
              participants: remote.doc.participants.map((p) =>
                p.id === 'person01' ? { ...p, origin: changed } : p,
              ),
            },
          },
          remote.doc,
          1,
          { person01: remote.replies[0]!.origin! },
        ),
      );
      expect(next.participants.value[1]?.origin).toEqual(changed);
      expect(next.replies.value.person01).toEqual(mergedMeeting(first).replies.value.person01);
    },
  );

  it.each([updatedAt, now])(
    '서버가 옛 답장 출발지를 비워도 이미 합친 출발지를 미전송 수정으로 보지 않는다: %s',
    (replyAt) => {
      const remote = state([reply({ origin: { name: '친구 집', lng: 128, lat: 38 } })]);
      const first = merge(library(), remote);
      const changed = { name: '주최자가 고친 집', lng: 127.5, lat: 37.6 };
      const next = mergedMeeting(
        merge(
          first,
          {
            ...remote,
            rev: 2,
            docRev: 2,
            replies: [reply({ origin: null, updatedAt: replyAt })],
            doc: {
              ...remote.doc,
              participants: remote.doc.participants.map((p) =>
                p.id === 'person01' ? { ...p, origin: changed } : p,
              ),
            },
          },
          remote.doc,
          1,
          { person01: remote.replies[0]!.origin! },
        ),
      );
      expect(next.participants.value[1]?.origin).toEqual(changed);
    },
  );

  it('답장 출발지를 합친 뒤 주최자가 직접 고친 출발지는 서버가 답장 출발지를 비워도 보존한다', () => {
    const remote = state([reply({ origin: { name: '친구 집', lng: 128, lat: 38 } })]);
    const first = mergedMeeting(merge(library(), remote));
    const localOrigin = { name: '미전송 집', lng: 127.5, lat: 37.6 };
    const local = {
      ...first,
      participants: {
        value: first.participants.value.map((p) =>
          p.id === 'person01' ? { ...p, origin: localOrigin } : p,
        ),
        updatedAt: '2026-10-27T00:00:00.000Z',
      },
    };
    const next = mergedMeeting(
      merge(library(local), {
        ...remote,
        rev: 2,
        docRev: 2,
        replies: [reply({ origin: null })],
      }),
    );
    expect(next.participants.value[1]?.origin).toEqual(localOrigin);
  });

  it('더 작은 시각이라도 다른 서버 답장은 출발지까지 반영한다', () => {
    const first = merge(library());
    const origin = { name: '옛집', lng: 128, lat: 38 };
    const next = mergedMeeting(
      merge(first, state([reply({ updatedAt: meeting.createdAt, origin, likes: [] })])),
    );
    expect(next.participants.value[1]?.origin).toEqual(origin);
    expect(next.replies.value.person01).toEqual({
      likes: [],
      sentAt: meeting.createdAt,
      receivedAt: now,
    });
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
    const next = mergedMeeting(
      merge(library(current), state([], decided), docFromMeeting(current, {}, 'min'), null),
    );
    expect(next.decided).toEqual({ value: decided, updatedAt: now });
  });

  it.each([null, 'choice01'])('마지막 동기화 뒤 바꾼 확정 %s는 서버가 덮지 못한다', (decided) => {
    const current = {
      ...meeting,
      decided: { value: decided, updatedAt: '2026-10-25T23:59:59.000Z' },
    };
    const lib = library(current);
    expect(
      merge(lib, state([], decided === null ? 'choice01' : null), {
        ...docFromMeeting(current, {}, 'min'),
        decided: decided === null ? 'choice01' : null,
      }),
    ).toBe(lib);
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
    const next = mergedMeeting(
      merge(library(current), remote, docFromMeeting(current, {}, 'min'), null),
    );
    expect(next.decided).toEqual({ value: 'choice02', updatedAt: now });
  });

  it('확정 내용이 마지막 동기화와 같으면 서버 확정을 반영한다', () => {
    const current = { ...meeting, decided: { value: 'choice01', updatedAt } };
    const next = mergedMeeting(
      merge(library(current), state([]), docFromMeeting(current, {}, 'min'), null),
    );
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
    for (const syncedDoc of [null, docFromMeeting(current, {}, 'min')]) {
      const next = merge(lib, state([], decided), syncedDoc);
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
    syncedDoc: docFromMeeting(meeting, {}, 'min'),
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
    const changes = {
      title: '로컬 제목',
      at: { date: '2026-10-28', time: '12:00' },
      mode: 'car' as const,
      participants: meeting.participants.value.map((p) => ({ ...p, name: '바꾼 이름' })),
      candidates: meeting.candidates.value.map((c) => ({ ...c, name: '바꾼 후보' })),
      decided: 'choice01',
    };
    const local = { ...meeting, [key]: { value: changes[key], updatedAt: now } };
    const initial = state([], 'choice01');
    const remote = { ...initial, doc: { ...initial.doc, title: '원격 제목' } };
    const result = mergeOnline(library(local), meeting.id, remote, ctx, {
      hostLikes: null,
      seen: [],
      syncedDoc: docFromMeeting(meeting, {}, 'min'),
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
    syncedDoc: docFromMeeting(meeting, {}, 'min'),
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
    syncedDoc: docFromMeeting(meeting, {}, 'min'),
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

it('서버 본문을 받으며 복원하는 답장 전용 참석자도 같은 시각의 답장 출발지를 쓴다', () => {
  const remote = state([reply({ participantId: 'new00001', origin })]);
  const first = mergedMeeting(merge(library(), remote));
  const local = {
    ...first,
    participants: {
      ...first.participants,
      value: first.participants.value.map((p) =>
        p.id === 'new00001' ? { ...p, origin: { name: '회사', lng: 128, lat: 38 } } : p,
      ),
    },
  };
  const result = mergeOnline(library(local), meeting.id, { ...remote, docRev: 2 }, ctx, {
    syncedDoc: remote.doc,
    docRev: 1,
    seen: ['new00001'],
    hostLikes: null,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const next = mergedMeeting(result.lib);
  expect(next.participants.value.find((p) => p.id === 'new00001')?.origin).toEqual(origin);
});

it('마지막 본문과 같은 후보의 로컬 참조 id는 주최자 수정으로 보지 않는다', () => {
  const local = {
    ...meeting,
    candidates: {
      ...meeting.candidates,
      value: meeting.candidates.value.map((c) => ({
        ...c,
        hubId: 'hub001',
        placeId: 'place00001',
      })),
    },
  };
  expect(hostEdits(local, docFromMeeting(local, {}, 'min'))).toBe(false);
});

it.each(['이름', '삭제', '추가'] as const)('주최자 참석자 %s는 내용 변경이다', (change) => {
  const participants =
    change === '이름'
      ? meeting.participants.value.map((p) => ({ ...p, name: '새 이름' }))
      : change === '삭제'
        ? meeting.participants.value.slice(0, 1)
        : [...meeting.participants.value, { id: 'person03', name: '새 친구', origin: null }];
  const local = { ...meeting, participants: { ...meeting.participants, value: participants } };
  expect(hostEdits(local, docFromMeeting(meeting, {}, 'min'))).toBe(true);
});

it('seen에 있어도 마지막 본문에 포함된 참석자 이름은 비교한다', () => {
  const local = {
    ...meeting,
    participants: {
      ...meeting.participants,
      value: meeting.participants.value.map((p) => ({ ...p, name: '새 이름' })),
    },
  };
  expect(hostEdits(local, docFromMeeting(meeting, {}, 'min'), ['person01'])).toBe(true);
});

it('답장 전용 참석자의 추가·변경·삭제는 주최자 수정에서 뺀다', () => {
  const syncedDoc = docFromMeeting(meeting, {}, 'min');
  const local = {
    ...meeting,
    participants: {
      ...meeting.participants,
      value: [...meeting.participants.value, { id: 'person03', name: '새 친구', origin }],
    },
  };
  expect(hostEdits(local, syncedDoc, ['person03'])).toBe(false);
  expect(hostEdits(meeting, syncedDoc, ['person03'])).toBe(false);
});

it('이미 합친 뒤 지운 답장 전용 참석자와 답장을 되살리지 않는다', () => {
  const lib = library();
  const result = mergeOnline(lib, meeting.id, state([reply({ participantId: 'new00001' })]), ctx, {
    syncedDoc: docFromMeeting(meeting, {}, 'min'),
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
      syncedDoc: docFromMeeting(meeting, {}, 'min'),
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

it('다른 기기 본문에 포함돼도 올리기 전 지운 답장 전용 참석자와 답장은 되살리지 않는다', () => {
  const remote = state([reply({ participantId: 'new00001', origin })]);
  const first = mergedMeeting(merge(library(), remote));
  const local = {
    ...first,
    participants: { ...first.participants, value: meeting.participants.value },
    replies: { ...first.replies, value: {} },
  };
  const result = mergeOnline(
    library(local),
    meeting.id,
    {
      ...remote,
      docRev: 2,
      doc: { ...remote.doc, title: '다른 기기 제목', participants: first.participants.value },
    },
    ctx,
    { syncedDoc: remote.doc, docRev: 1, seen: ['new00001'], hostLikes: null },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const next = mergedMeeting(result.lib);
  expect(next.title.value).toBe('다른 기기 제목');
  expect(next.participants.value.some((p) => p.id === 'new00001')).toBe(false);
  expect(next.replies.value.new00001).toBeUndefined();
  expect(result.addedReplyOnly).toEqual([]);
  expect(safeParse(LibrarySchema, result.lib).success).toBe(true);
});

it('기록보다 낮은 본문 버전은 받지 않고 새 답장만 합친다', () => {
  const remote = state([reply()], 'choice01');
  const next = mergedMeeting(merge(library(), remote, docFromMeeting(meeting, {}, 'min'), 2));
  expect(next.decided.value).toBeNull();
  expect(next.replies.value.person01?.likes).toEqual(['choice01']);
});

it('답장 출발지를 적용한 참석자별로 기록하고 없어진 참석자 기록은 버린다', () => {
  const changed = { name: '회사', lng: 128, lat: 38 };
  const result = mergeOnline(library(), meeting.id, state([reply({ origin: changed })]), ctx, {
    syncedDoc: docFromMeeting(meeting, {}, 'min'),
    docRev: 1,
    hostLikes: null,
    seen: [],
    replyOrigins: { removed1: origin },
  });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.replyOrigins).toEqual({ person01: changed });
});

it.each(['host0001', 'person01'])(
  '시각이 같아도 %s의 직접 출발지 수정은 답장 출처 기록과 비교한다',
  (pid) => {
    const imported = { name: '회사', lng: 128, lat: 38 };
    const local = {
      ...meeting,
      participants: {
        updatedAt: now,
        value: meeting.participants.value.map((p) =>
          p.id === pid ? { ...p, origin: imported } : p,
        ),
      },
      replies: { updatedAt: now, value: { [pid]: { likes: [], sentAt: now, receivedAt: now } } },
    };
    const syncedDoc = docFromMeeting(meeting, {}, 'min');
    expect(hostEdits(local, syncedDoc, [], { [pid]: origin })).toBe(true);
    expect(hostEdits(local, syncedDoc, [], { [pid]: imported })).toBe(pid === 'host0001');
  },
);
