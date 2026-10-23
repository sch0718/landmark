import { describe, expect, it } from 'vitest';
import * as ops from 'src/domain/meeting/ops';
import { emptyLibrary, LibrarySchema, type Library } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import type { OpResult } from 'src/domain/library/ops';
import { buildMeeting } from '../../../fixtures/builders';

const now = '2026-10-24T00:00:00.000Z';
const ctx = () => {
  let n = 0;
  return { now, newId: (kind: string) => String(++n).padStart(kind === 'meeting' ? 10 : 8, '0') };
};
const m = buildMeeting();
const lib = (meeting = m): Library => ({ ...emptyLibrary(), meetings: { [meeting.id]: meeting } });
const good = (r: OpResult) => {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(safeParse(LibrarySchema, r.lib).success).toBe(true);
  return r.lib;
};
const error = (r: OpResult, reason: string) =>
  expect(r).toMatchObject({ ok: false, error: { _tag: 'MeetingOpError', reason } });
const read = (l: Library) => l.meetings![m.id]!;

describe('약속 연산', () => {
  it('새 약속은 주최자 한 명과 기본값을 만들고 입력은 바꾸지 않는다', () => {
    const before = emptyLibrary();
    const r = ops.createMeeting(before, { title: ' 모임 ', at: null, mode: 'transit' }, ctx());
    const next = good(r);
    if (!r.ok) return;
    const created = next.meetings![r.createdId!]!;
    expect(created.title.value).toBe('모임');
    expect(created.participants.value).toEqual([{ id: '00000002', name: '나', origin: null }]);
    expect(created.rank.value).toBe('max');
    expect(created.candidates.value).toEqual([]);
    expect(before).toEqual(emptyLibrary());
  });
  it('기본 정보는 바뀐 필드만 갱신하고 같은 값은 같은 참조다', () => {
    const before = lib();
    const next = good(
      ops.updateMeeting(
        before,
        m.id,
        { title: '새 모임', rank: 'avg', mode: 'car', at: { date: '2026-10-31', time: '18:00' } },
        ctx(),
      ),
    );
    expect(read(next).title.updatedAt).toBe(now);
    expect(read(next).participants).toBe(m.participants);
    expect(good(ops.updateMeeting(next, m.id, { title: '새 모임' }, ctx()))).toBe(next);
  });
  it('묘비로 지우고 되살린다', () => {
    const deleted = good(ops.deleteMeeting(lib(), m.id, ctx()));
    expect(read(deleted).deletedAt).toBe(now);
    expect(read(deleted).title).toBe(m.title);
    error(ops.updateMeeting(deleted, m.id, { title: '불가' }, ctx()), 'not-found');
    expect(read(good(ops.restoreMeeting(deleted, m.id, ctx()))).deletedAt).toBeNull();
  });
  it('참석자 추가·수정·삭제 때 답장을 함께 지운다', () => {
    let next = good(ops.addParticipant(lib(), m.id, { name: '친구', origin: null }, ctx()));
    const pid = read(next).participants.value[1]!.id;
    next = good(
      ops.updateParticipant(
        next,
        m.id,
        pid,
        { name: '수정', origin: { name: '집', lng: 127, lat: 37 } },
        ctx(),
      ),
    );
    next = good(ops.toggleLike(next, m.id, pid, 'choice01', ctx()));
    expect(read(next).replies.value[pid]).toEqual({
      likes: ['choice01'],
      sentAt: now,
      receivedAt: now,
    });
    next = good(ops.removeParticipant(next, m.id, pid, ctx()));
    expect(read(next).replies.value[pid]).toBeUndefined();
    expect(read(next).participants.updatedAt).toBe(now);
    expect(read(next).replies.updatedAt).toBe(now);
  });
  it('후보 삭제 때 모든 좋아요와 확정을 함께 지운다', () => {
    let next = good(
      ops.addCandidate(
        lib(),
        m.id,
        { kind: 'place', name: '카페', lng: 128, lat: 37, placeId: 'place00001' },
        ctx(),
      ),
    );
    const cid = read(next).candidates.value[1]!.id;
    next = good(ops.toggleLike(next, m.id, 'person01', cid, ctx()));
    next = good(ops.decide(next, m.id, cid, ctx()));
    next = good(ops.removeCandidate(next, m.id, cid, ctx()));
    expect(read(next).decided).toEqual({ value: null, updatedAt: now });
    expect(read(next).replies.value.person01!.likes).toEqual([]);
    expect(read(next).candidates.updatedAt).toBe(now);
  });
  it('좋아요 토글과 확정 취소', () => {
    let next = good(ops.toggleLike(lib(), m.id, 'person01', 'choice01', ctx()));
    next = good(ops.toggleLike(next, m.id, 'person01', 'choice01', ctx()));
    expect(read(next).replies.value.person01!.likes).toEqual([]);
    next = good(ops.decide(next, m.id, 'choice01', ctx()));
    next = good(ops.decide(next, m.id, null, ctx()));
    expect(read(next).decided.value).toBeNull();
  });
  it('참석자는 10명까지다', () => {
    const full = buildMeeting({
      participants: {
        ...m.participants,
        value: Array.from({ length: 10 }, (_, i) => ({
          id: String(i).padStart(8, '0'),
          name: '친구',
          origin: null,
        })),
      },
    });
    error(
      ops.addParticipant(lib(full), m.id, { name: '넘침', origin: null }, ctx()),
      'participants-full',
    );
  });
  it('후보는 8곳까지다', () => {
    const full = buildMeeting({
      candidates: {
        ...m.candidates,
        value: Array.from({ length: 8 }, (_, i) => ({
          ...m.candidates.value[0]!,
          id: String(i).padStart(8, '0'),
        })),
      },
    });
    error(
      ops.addCandidate(lib(full), m.id, { kind: 'hub', name: '다른 역', lng: 128, lat: 38 }, ctx()),
      'candidates-full',
    );
  });
  it.each(['hubId', 'placeId', 'near'] as const)('중복 후보 %s 거부', (key) => {
    const info = { ...m.candidates.value[0]!, hubId: 'hub001', placeId: 'place00001' };
    const before = lib({ ...m, candidates: { ...m.candidates, value: [info] } });
    const candidate =
      key === 'near'
        ? { kind: 'hub' as const, name: info.name, lng: info.lng + 0.00001, lat: info.lat }
        : { kind: 'place' as const, name: '다른 이름', lng: 128, lat: 38, [key]: info[key] };
    error(ops.addCandidate(before, m.id, candidate, ctx()), 'candidate-exists');
  });
  it('묘비 포함 200개면 새로 만들지 않는다', () => {
    const meetings = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => {
        const id = String(i).padStart(10, '0');
        return [id, { ...m, id, deletedAt: now }];
      }),
    );
    error(
      ops.createMeeting(
        { ...emptyLibrary(), meetings },
        { title: '모임', at: null, mode: 'car' },
        ctx(),
      ),
      'meetings-full',
    );
  });
  it.each(['title', 'name', 'coordinate', 'reference'] as const)(
    '유효하지 않은 입력 %s 거부',
    (key) => {
      const before = lib();
      const r =
        key === 'title'
          ? ops.updateMeeting(before, m.id, { title: '' }, ctx())
          : key === 'name'
            ? ops.addParticipant(before, m.id, { name: '', origin: null }, ctx())
            : key === 'coordinate'
              ? ops.addCandidate(before, m.id, { kind: 'hub', name: '역', lng: 0, lat: 0 }, ctx())
              : ops.decide(before, m.id, 'missing1', ctx());
      error(r, 'invalid');
      expect(before).toEqual(lib());
    },
  );
  it('없는 참석자·후보·약속은 바꾸지 않는다', () => {
    error(ops.updateParticipant(lib(), m.id, 'missing1', { name: '친구' }, ctx()), 'not-found');
    error(ops.removeParticipant(lib(), m.id, 'missing1', ctx()), 'not-found');
    error(ops.removeCandidate(lib(), m.id, 'missing1', ctx()), 'not-found');
    error(ops.toggleLike(lib(), m.id, 'missing1', 'choice01', ctx()), 'invalid');
    error(ops.restoreMeeting(lib(), 'missing001', ctx()), 'not-found');
  });
});
