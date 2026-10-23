import { describe, expect, it } from 'vitest';
import { applyReply, previewReply } from 'src/domain/meeting/apply-reply';
import { replyFromDraft, type ReplyDoc } from 'src/domain/meeting/link';
import { emptyLibrary, LibrarySchema } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { buildMeeting } from '../../../fixtures/builders';
import type { Meeting } from 'src/schema/meeting';

const base = buildMeeting();
const m = buildMeeting({
  participants: {
    ...base.participants,
    value: [
      { id: 'host0001', name: '나', origin: null },
      { id: 'person01', name: '친구', origin: null },
    ],
  },
});
const now = '2026-10-24T00:00:00.000Z';
const ctx = { now, newId: () => 'new00001' };
const reply = (patch: Partial<ReplyDoc> = {}) =>
  replyFromDraft({
    meetingId: m.id,
    participantId: 'person01',
    likes: ['choice01'],
    sentAt: m.createdAt,
    ...patch,
  });
const apply = (meeting: Meeting, doc: ReplyDoc) => {
  const before = { ...emptyLibrary(), meetings: { [meeting.id]: meeting } };
  const original = JSON.stringify(before);
  const result = applyReply(before, meeting.id, doc, ctx);
  expect(JSON.stringify(before)).toBe(original);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result));
  expect(safeParse(LibrarySchema, result.lib).success).toBe(true);
  return result.lib.meetings![meeting.id]!;
};

describe('답장 미리보기와 반영', () => {
  it.each(['id', 'name'] as const)(
    '주최자를 가리키는 답장은 미리보기와 반영 모두 거부한다 (%s)',
    (by) => {
      const current = {
        ...m,
        replies: {
          ...m.replies,
          value: {
            host0001: { likes: ['choice01'], sentAt: m.createdAt, receivedAt: m.createdAt },
          },
        },
      };
      const doc = reply({
        ...(by === 'id'
          ? { participantId: 'host0001' }
          : { participantId: undefined, newName: '  나  ' }),
        likes: [],
        sentAt: now,
        origin: { name: '바뀐 출발지', lng: 127, lat: 37 },
      });
      const before = { ...emptyLibrary(), meetings: { [m.id]: current } };
      const original = JSON.stringify(before);
      expect(previewReply(current, doc)).toEqual({ kind: 'host' });
      expect(applyReply(before, m.id, doc, ctx)).toMatchObject({
        ok: false,
        error: { _tag: 'ReplyRejected', reason: 'host' },
      });
      expect(JSON.stringify(before)).toBe(original);
    },
  );
  it('같은 사람의 답장은 덮어쓰고 받은 시각은 지금이다', () => {
    const first = apply(m, reply());
    expect(first.replies.value.person01).toEqual({
      likes: ['choice01'],
      sentAt: m.createdAt,
      receivedAt: now,
    });
    const next = apply(first, reply({ likes: [], sentAt: now }));
    expect(next.replies.value.person01!.likes).toEqual([]);
    expect(next.replies.updatedAt).toBe(now);
  });
  it('오래된 답장은 미리보기와 반영 모두 거부한다', () => {
    const current = apply(m, reply({ sentAt: now }));
    expect(previewReply(current, reply())).toEqual({ kind: 'stale' });
    expect(
      applyReply({ ...emptyLibrary(), meetings: { [m.id]: current } }, m.id, reply(), ctx),
    ).toMatchObject({ ok: false, error: { reason: 'stale' } });
  });
  it('같은 시각 답장은 허용한다', () => {
    const current = apply(m, reply());
    expect(previewReply(current, reply()).kind).toBe('ok');
  });
  it('NFC와 공백 정리로 기존 이름을 찾고 인원수 제한을 적용하지 않는다', () => {
    const participants = Array.from({ length: 10 }, (_, i) => ({
      id: String(i).padStart(8, '0'),
      name: i === 1 ? '홍 길동' : `친구${i}`,
      origin: null,
    }));
    const meeting = { ...m, participants: { ...m.participants, value: participants } };
    const doc = reply({ participantId: undefined, newName: '  홍   길동  '.normalize('NFD') });
    const next = apply(meeting, doc);
    expect(next.participants.value).toHaveLength(10);
    expect(next.replies.value['00000001']!.likes).toEqual(['choice01']);
  });
  it('새 이름은 한 명 더하고 출발지도 반영한다', () => {
    const origin = { name: '집', lng: 127, lat: 37 };
    const doc = reply({ participantId: undefined, newName: ' 새 친구 ', origin });
    expect(previewReply(m, doc)).toMatchObject({
      kind: 'ok',
      participant: { name: '새 친구', isNew: true },
      originChanged: true,
    });
    const next = apply(m, doc);
    expect(next.participants.value[2]).toEqual({ id: 'new00001', name: '새 친구', origin });
    expect(next.participants.updatedAt).toBe(now);
  });
  it('10명이면 새 이름 답장은 거부한다', () => {
    const meeting = {
      ...m,
      participants: {
        ...m.participants,
        value: Array.from({ length: 10 }, (_, i) => ({
          id: String(i).padStart(8, '0'),
          name: `친구${i}`,
          origin: null,
        })),
      },
    };
    const doc = reply({ participantId: undefined, newName: '다른 친구' });
    expect(previewReply(meeting, doc)).toEqual({ kind: 'full' });
    expect(
      applyReply({ ...emptyLibrary(), meetings: { [m.id]: meeting } }, m.id, doc, ctx),
    ).toMatchObject({ ok: false, error: { reason: 'full' } });
  });
  it('출발지 생략은 유지하고 null이면 비운다', () => {
    const origin = { name: '집', lng: 127, lat: 37 };
    const current = apply(m, reply({ origin }));
    expect(apply(current, reply()).participants.value[1]!.origin).toEqual(origin);
    expect(previewReply(current, reply()).kind).toBe('ok');
    const cleared = apply(current, reply({ origin: null }));
    expect(cleared.participants.value[1]!.origin).toBeNull();
  });
  it('없어진 후보 좋아요는 버리고 개수를 미리 보여 준다. 확정은 유지한다', () => {
    const meeting = { ...m, decided: { ...m.decided, value: 'choice01' } };
    const doc = reply({ likes: ['choice01', 'deleted1'] });
    expect(previewReply(meeting, doc)).toMatchObject({
      kind: 'ok',
      likes: ['choice01'],
      droppedLikes: 1,
      originChanged: false,
    });
    const next = apply(meeting, doc);
    expect(next.replies.value.person01!.likes).toEqual(['choice01']);
    expect(next.decided).toBe(meeting.decided);
  });
  it('다른 약속·삭제된 참석자·삭제된 약속에는 반영하지 않는다', () => {
    expect(previewReply(m, reply({ meetingId: 'another001' }))).toEqual({ kind: 'other-meeting' });
    expect(previewReply(m, reply({ participantId: 'deleted1' }))).toEqual({
      kind: 'other-meeting',
    });
    expect(applyReply(emptyLibrary(), m.id, reply(), ctx).ok).toBe(false);
    expect(
      applyReply(
        { ...emptyLibrary(), meetings: { [m.id]: { ...m, deletedAt: now } } },
        m.id,
        reply(),
        ctx,
      ).ok,
    ).toBe(false);
  });
});
