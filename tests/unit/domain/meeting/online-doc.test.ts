import { describe, expect, it } from 'vitest';
import {
  docFromMeeting,
  MEET_DOC_BYTES_MAX,
  MeetingDocSchema,
  OnlineReplySchema,
  OnlineStateSchema,
  ReplyInputSchema,
} from 'src/domain/meeting/online-doc';
import { safeParse } from 'src/schema/parse';
import { buildMeeting } from '../../../fixtures/builders';

const meeting = buildMeeting();
const doc = () => docFromMeeting(meeting, { choice01: { person01: 10 } }, 'min');
const origin = { name: '집', lng: 127, lat: 37.5 };
const reply = () => ({
  participantId: 'person02',
  name: '친구',
  origin: null,
  likes: ['choice01'],
  times: { choice01: 20 },
  updatedAt: meeting.createdAt,
});
const strict = { onExcessProperty: 'error' } as const;

describe('온라인 약속 문서', () => {
  it('정상 문서와 확정 후보를 읽는다', () => {
    expect(safeParse(MeetingDocSchema, doc(), strict).success).toBe(true);
    expect(safeParse(MeetingDocSchema, { ...doc(), decided: 'choice01' }, strict).success).toBe(
      true,
    );
  });

  it('참석자 출발지·후보·시간·단위·확정을 옮기고 링크 전용 필드는 싣지 않는다', () => {
    const current = buildMeeting({
      mode: { ...meeting.mode, value: 'straight' },
      participants: {
        ...meeting.participants,
        value: [{ ...meeting.participants.value[0]!, origin }],
      },
      candidates: {
        ...meeting.candidates,
        value: [{ ...meeting.candidates.value[0]!, hubId: 'hub001', placeId: 'place00001' }],
      },
      decided: { ...meeting.decided, value: 'choice01' },
    });
    expect(docFromMeeting(current, { choice01: { person01: 1234 } }, 'm')).toEqual({
      meetingId: current.id,
      title: current.title.value,
      at: current.at.value,
      mode: 'straight',
      participants: current.participants.value,
      candidates: [{ id: 'choice01', kind: 'hub', name: '강남역', lng: 127, lat: 37.5 }],
      times: { choice01: { person01: 1234 } },
      unit: 'm',
      decided: 'choice01',
    });
    expect(docFromMeeting(meeting, {}, 'min').times).toEqual({ choice01: { person01: null } });
  });

  it.each(['format', 'v', 'kind', 'sentAt'])('링크 전용 키 %s를 거부한다', (key) => {
    expect(
      safeParse(MeetingDocSchema, { ...doc(), [key]: meeting.createdAt }, strict).success,
    ).toBe(false);
  });

  it.each([
    ['없는 확정 후보', () => ({ ...doc(), decided: 'missing1' })],
    [
      '참석자 중복',
      () => ({ ...doc(), participants: [...doc().participants, ...doc().participants] }),
    ],
    ['후보 중복', () => ({ ...doc(), candidates: [...doc().candidates, ...doc().candidates] })],
    ['없는 후보 시간', () => ({ ...doc(), times: { missing1: { person01: 1 } } })],
    ['없는 참석자 시간', () => ({ ...doc(), times: { choice01: { missing1: 1 } } })],
    ['단위 불일치', () => ({ ...doc(), unit: 'm' })],
    ['음수 시간', () => ({ ...doc(), times: { choice01: { person01: -1 } } })],
    ['소수 시간', () => ({ ...doc(), times: { choice01: { person01: 1.5 } } })],
    [
      '중첩된 남는 키',
      () => ({ ...doc(), participants: [{ ...doc().participants[0], extra: true }] }),
    ],
    [
      '한국 밖 좌표',
      () => ({
        ...doc(),
        participants: [{ ...doc().participants[0], origin: { ...origin, lng: 0 } }],
      }),
    ],
  ] as const)('%s를 거부한다', (_name, invalid) => {
    expect(safeParse(MeetingDocSchema, invalid(), strict).success).toBe(false);
  });

  it('참석자 10명과 후보 8곳 한도를 지킨다', () => {
    const participants = Array.from({ length: 10 }, (_, i) => ({
      id: String(i).padStart(8, '0'),
      name: `친구${i}`,
      origin: null,
    }));
    const candidates = Array.from({ length: 8 }, (_, i) => ({
      ...doc().candidates[0]!,
      id: String(i).padStart(8, '0'),
    }));
    const full = { ...doc(), participants, candidates, times: {} };
    expect(safeParse(MeetingDocSchema, full, strict).success).toBe(true);
    expect(
      safeParse(
        MeetingDocSchema,
        { ...full, participants: [...participants, { ...participants[0]!, id: 'extra001' }] },
        strict,
      ).success,
    ).toBe(false);
    expect(
      safeParse(
        MeetingDocSchema,
        { ...full, candidates: [...candidates, { ...candidates[0]!, id: 'extra001' }] },
        strict,
      ).success,
    ).toBe(false);
  });

  it('직렬화한 UTF-8 본문 64KB 초과를 거부한다', () => {
    const oversized = { ...doc(), title: '가'.repeat(22_000) };
    expect(MEET_DOC_BYTES_MAX).toBe(65_536);
    expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength).toBeGreaterThan(
      MEET_DOC_BYTES_MAX,
    );
    expect(safeParse(MeetingDocSchema, oversized, strict).success).toBe(false);
  });
});

describe('온라인 답장과 상태', () => {
  it('답장의 출발지·소요시간을 읽고 null도 허용한다', () => {
    expect(safeParse(OnlineReplySchema, reply(), strict).success).toBe(true);
    expect(safeParse(OnlineReplySchema, { ...reply(), origin, times: null }, strict).success).toBe(
      true,
    );
  });

  it('입력은 신원 없이 좋아요를 받고 출발지·시간은 생략하거나 null로 보낸다', () => {
    for (const input of [
      { likes: [] },
      { likes: ['choice01'], origin, times: { choice01: null } },
      { likes: [], origin: null, times: null },
    ]) {
      expect(safeParse(ReplyInputSchema, input, strict).success).toBe(true);
    }
    expect(
      safeParse(ReplyInputSchema, { likes: [], participantId: 'person02' }, strict).success,
    ).toBe(false);
  });

  it.each([
    ['중복 좋아요', { likes: ['choice01', 'choice01'] }],
    ['9개 좋아요', { likes: Array.from({ length: 9 }, (_, i) => String(i).padStart(8, '0')) }],
    ['잘못된 후보 키', { times: { bad: 1 } }],
    ['음수 시간', { times: { choice01: -1 } }],
    ['소수 시간', { times: { choice01: 1.5 } }],
  ])('%s는 답장과 입력 모두 거부한다', (_name, patch) => {
    expect(safeParse(OnlineReplySchema, { ...reply(), ...patch }, strict).success).toBe(false);
    expect(safeParse(ReplyInputSchema, { likes: [], ...patch }, strict).success).toBe(false);
  });

  it('답장 이름·참석자 id·갱신 시각을 검사한다', () => {
    for (const patch of [{ name: '' }, { participantId: 'bad' }, { updatedAt: '어제' }]) {
      expect(safeParse(OnlineReplySchema, { ...reply(), ...patch }, strict).success).toBe(false);
    }
  });

  it('새 참석자 답장과 좌표를 가린 상태의 출발지 이름을 읽는다', () => {
    const state = {
      rev: 2,
      docRev: 1,
      doc: doc(),
      replies: [reply()],
      originNames: { person01: '집' },
    };
    expect(safeParse(OnlineStateSchema, state, strict).success).toBe(true);
    const hostState = {
      rev: state.rev,
      docRev: state.docRev,
      doc: state.doc,
      replies: state.replies,
    };
    expect(safeParse(OnlineStateSchema, hostState, strict).success).toBe(true);
  });

  it('버전·답장 수·출발지 이름의 키와 값을 검사한다', () => {
    const state = { rev: 1, docRev: 1, doc: doc(), replies: [] };
    for (const patch of [
      { rev: 0 },
      { rev: 1.5 },
      { replies: Array.from({ length: 11 }, reply) },
      { originNames: { bad: '집' } },
      { originNames: { person01: '' } },
    ]) {
      expect(safeParse(OnlineStateSchema, { ...state, ...patch }, strict).success).toBe(false);
    }
  });
  it.each([undefined, null, 0, -1, 1.5, '1'])('본문 버전 %s를 거부한다', (docRev) => {
    expect(safeParse(OnlineStateSchema, { rev: 2, docRev, doc: doc(), replies: [] }).success).toBe(
      false,
    );
  });
});
