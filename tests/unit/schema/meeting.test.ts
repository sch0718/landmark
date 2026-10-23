import { describe, expect, it } from 'vitest';
import { buildMeeting } from '../../fixtures/builders';
import { MeetingSchema, checkMeeting } from 'src/schema/meeting';
import { emptyLibrary, LibrarySchema } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';

const meeting = buildMeeting();
const f = <T>(value: T) => ({ value, updatedAt: meeting.createdAt });
const lib = (m = meeting) => ({ ...emptyLibrary(), meetings: { [m.id]: m } });

describe('약속 저장 형식', () => {
  it('정상 약속과 보관함을 읽는다', () => {
    expect(safeParse(MeetingSchema, meeting).success).toBe(true);
    expect(safeParse(LibrarySchema, lib()).success).toBe(true);
  });
  it.each([0, 61])('제목 %i자는 거부한다', (n) => {
    expect(safeParse(MeetingSchema, { ...meeting, title: f('가'.repeat(n)) }).success).toBe(false);
  });
  it('제목 60자는 허용한다', () => {
    expect(safeParse(MeetingSchema, { ...meeting, title: f('가'.repeat(60)) }).success).toBe(true);
  });
  it.each([
    [10, true],
    [11, false],
  ])('참석자 %i명 경계', (n, valid) => {
    const participants = Array.from({ length: n }, (_, i) => ({
      id: String(i).padStart(8, '0'),
      name: '친구',
      origin: null,
    }));
    expect(
      safeParse(LibrarySchema, lib({ ...meeting, participants: f(participants) })).success,
    ).toBe(valid);
  });
  it.each([
    [8, true],
    [9, false],
  ])('후보 %i곳 경계', (n, valid) => {
    const candidates = Array.from({ length: n }, (_, i) => ({
      ...meeting.candidates.value[0]!,
      id: String(i).padStart(8, '0'),
    }));
    expect(safeParse(LibrarySchema, lib({ ...meeting, candidates: f(candidates) })).success).toBe(
      valid,
    );
  });
  it.each([
    [123.9, 37],
    [132.1, 37],
    [127, 32.9],
    [127, 39.1],
    [Infinity, 37],
    [127, NaN],
  ])('범위 밖 좌표 %s,%s 거부', (lng, lat) => {
    expect(
      safeParse(MeetingSchema, {
        ...meeting,
        participants: f([{ id: 'person01', name: '나', origin: { name: '집', lng, lat } }]),
      }).success,
    ).toBe(false);
  });
  it.each(['participants', 'candidates'] as const)('%s id 중복 거부', (key) => {
    const invalid = { ...meeting, [key]: f([...meeting[key].value, ...meeting[key].value]) };
    expect(safeParse(LibrarySchema, lib(invalid)).success).toBe(false);
  });
  it.each([
    {
      replies: f({
        unknown1: { likes: [], sentAt: meeting.createdAt, receivedAt: meeting.createdAt },
      }),
    },
    {
      replies: f({
        person01: { likes: ['unknown1'], sentAt: meeting.createdAt, receivedAt: meeting.createdAt },
      }),
    },
    {
      replies: f({
        person01: {
          likes: ['choice01', 'choice01'],
          sentAt: meeting.createdAt,
          receivedAt: meeting.createdAt,
        },
      }),
    },
    { decided: f('unknown1') },
  ])('관계 오류를 경로와 함께 보고한다 %#', (patch) => {
    const invalid = { ...meeting, ...patch };
    expect(checkMeeting(invalid, ['meetings', meeting.id]).length).toBeGreaterThan(0);
    expect(safeParse(LibrarySchema, lib(invalid)).success).toBe(false);
  });
  it('장소 참고 id는 보관함에 없어도 된다', () => {
    const m = {
      ...meeting,
      participants: f([
        {
          id: 'person01',
          name: '나',
          origin: { name: '집', lng: 124, lat: 33, placeId: 'missing001' },
        },
      ]),
    };
    expect(safeParse(LibrarySchema, lib(m)).success).toBe(true);
  });
  it('키와 id가 다르면 버리지 않고 거부한다', () => {
    expect(
      safeParse(LibrarySchema, { ...emptyLibrary(), meetings: { wrong: meeting } }).success,
    ).toBe(false);
  });
  it('옛 문서와 빈 meetings를 읽는다', () => {
    expect(safeParse(LibrarySchema, emptyLibrary()).success).toBe(true);
    expect(safeParse(LibrarySchema, { ...emptyLibrary(), meetings: {} }).success).toBe(true);
  });
  it.each([
    [200, true],
    [201, false],
  ])('묘비 포함 %i개 경계', (n, valid) => {
    const meetings = Object.fromEntries(
      Array.from({ length: n }, (_, i) => {
        const id = String(i).padStart(10, '0');
        return [id, { ...meeting, id, deletedAt: meeting.createdAt }];
      }),
    );
    expect(safeParse(LibrarySchema, { ...emptyLibrary(), meetings }).success).toBe(valid);
  });
});
