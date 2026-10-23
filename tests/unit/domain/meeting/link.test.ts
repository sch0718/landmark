import { describe, expect, it } from 'vitest';
import { encodeCompressedJson } from 'src/domain/codec';
import {
  finalFromMeeting,
  inviteFromMeeting,
  meetLink,
  readMeetHash,
  replyFromDraft,
  type MeetDoc,
} from 'src/domain/meeting/link';
import { buildMeeting } from '../../../fixtures/builders';

const m = buildMeeting();
const invite = () => inviteFromMeeting(m, { choice01: { person01: 10 } }, 'min', m.createdAt);
const reply = () =>
  replyFromDraft({
    meetingId: m.id,
    participantId: 'person01',
    likes: ['choice01'],
    sentAt: m.createdAt,
  });
const final = () => finalFromMeeting({ ...m, decided: { ...m.decided, value: 'choice01' } })!;
const readRaw = async (doc: unknown, kind = 'd') =>
  readMeetHash(`#${kind}=${await encodeCompressedJson(doc)}`);

describe('약속 링크', () => {
  it.each([invite, reply, final])('세 종류를 왕복한다 %#', async (make) => {
    const doc = make();
    const link = await meetLink(doc, 'https://example.test/');
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    expect(link.url).toContain(`https://example.test/meet#${doc.kind}=`);
    expect(await readMeetHash(new URL(link.url).hash)).toEqual({ ok: true, doc });
  });
  it('후보 링크에는 저장 전용 참고 id를 싣지 않고 빈 칸을 null로 채운다', () => {
    const meeting = {
      ...m,
      candidates: {
        ...m.candidates,
        value: [{ ...m.candidates.value[0]!, hubId: 'hub001', placeId: 'place00001' }],
      },
    };
    const doc = inviteFromMeeting(meeting, {}, 'min', m.createdAt);
    expect(doc.candidates[0]).not.toHaveProperty('hubId');
    expect(doc.candidates[0]).not.toHaveProperty('placeId');
    expect(doc.times).toEqual({ choice01: { person01: null } });
    expect(finalFromMeeting(m)).toBeNull();
  });
  it.each([
    'root',
    'nested',
    'coordinate',
    'time',
    'unit',
    'reference',
    'duplicate',
    'count',
  ] as const)('엄격한 검증 %s', async (what) => {
    const doc = invite();
    const invalid =
      what === 'root'
        ? { ...doc, extra: true }
        : what === 'nested'
          ? { ...doc, candidates: [{ ...doc.candidates[0], extra: true }] }
          : what === 'coordinate'
            ? { ...doc, candidates: [{ ...doc.candidates[0], lng: 0 }] }
            : what === 'time'
              ? { ...doc, times: { choice01: { person01: -1 } } }
              : what === 'unit'
                ? { ...doc, unit: 'm' }
                : what === 'reference'
                  ? { ...doc, times: { missing1: { person01: 3 } } }
                  : what === 'duplicate'
                    ? { ...doc, participants: [...doc.participants, ...doc.participants] }
                    : {
                        ...doc,
                        participants: Array.from({ length: 11 }, (_, i) => ({
                          ...doc.participants[0]!,
                          id: String(i).padStart(8, '0'),
                        })),
                      };
    expect(await readRaw(invalid)).toEqual({ ok: false, reason: 'invalid' });
  });
  it.each(['both', 'neither'] as const)('답장 신원은 정확히 하나: %s 거부', async (what) => {
    const { participantId, ...rest } = reply();
    const invalid = what === 'both' ? { ...rest, participantId, newName: '친구' } : rest;
    expect(await readRaw(invalid, 'r')).toEqual({ ok: false, reason: 'invalid' });
  });
  it('답장 중복 좋아요와 빈 이름은 거부한다', async () => {
    expect(await readRaw({ ...reply(), likes: ['choice01', 'choice01'] }, 'r')).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(await readRaw({ ...reply(), participantId: undefined, newName: '' }, 'r')).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
  it('빈 해시·깨진 압축·해시 종류 불일치', async () => {
    expect(await readMeetHash('')).toEqual({ ok: false, reason: 'missing' });
    expect(await readMeetHash('#r=%%%')).toEqual({ ok: false, reason: 'corrupt' });
    expect(await readRaw(reply(), 'd')).toEqual({ ok: false, reason: 'invalid' });
    expect(await readMeetHash('#x=abc')).toEqual({ ok: false, reason: 'invalid' });
  });
  it('해시 8000자와 압축 해제 64KB 제한', async () => {
    expect(await readMeetHash('#d=' + 'a'.repeat(8000))).toEqual({ ok: false, reason: 'too-long' });
    const oversized = { ...invite(), title: '가'.repeat(66000) };
    expect(await readRaw(oversized)).toEqual({ ok: false, reason: 'too-long' });
    expect(await meetLink(oversized as MeetDoc, 'https://example.test')).toEqual({
      ok: false,
      reason: 'too-long',
    });
  });
});
