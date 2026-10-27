import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadMeetDraft,
  loadMeetDraftEntry,
  removeMeetDraft,
  saveMeetDraft,
  MEET_DRAFTS_KEY,
} from 'src/sections/meetings/meet-drafts';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';

const draft = { participantId: 'person01', likes: ['choice01'], origin: null };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('약속 답장 초안', () => {
  it('신원·빈 좋아요·출발지 null을 그대로 저장하고 복원한다', () => {
    const storage = createMemoryStorage();
    saveMeetDraft('meeting001', draft, storage);
    expect(loadMeetDraft('meeting001', storage)).toEqual(draft);
    saveMeetDraft('meeting001', { newName: '민지', likes: [] }, storage);
    expect(loadMeetDraft('meeting001', storage)).toEqual({ newName: '민지', likes: [] });
  });
  it('20개를 넘기면 가장 오래 안 읽은 약속을 버린다', () => {
    const storage = createMemoryStorage();
    for (let i = 0; i < 20; i++)
      saveMeetDraft(`meeting${String(i).padStart(3, '0')}`, draft, storage);
    expect(loadMeetDraft('meeting000', storage)).toEqual(draft);
    saveMeetDraft('meeting020', draft, storage);
    expect(loadMeetDraft('meeting001', storage)).toBeNull();
    expect(loadMeetDraft('meeting000', storage)).toEqual(draft);
    expect(loadMeetDraft('meeting020', storage)).toEqual(draft);
  });
  it.each([
    { participantId: 'person01', newName: '민지', likes: [] },
    { participantId: 'person01', likes: ['choice01', 'choice01'] },
    { participantId: 'person01', likes: [42] },
    { participantId: 'person01', likes: [], origin: { name: '범위 밖', lng: 140, lat: 37 } },
    { participantId: 'person01', likes: [], other: '무시하지 않음' },
  ])('잘못된 초안을 저장하지 않는다: %j', (invalid) => {
    const storage = createMemoryStorage();
    saveMeetDraft('meeting001', invalid as unknown as typeof draft, storage);
    expect(loadMeetDraft('meeting001', storage)).toBeNull();
  });
  it('깨진 JSON·다른 형식·저장소 접근 실패는 동작을 막지 않는다', () => {
    const storage = createMemoryStorage();
    for (const value of [
      '{',
      'null',
      '42',
      '{"drafts":[{"meetingId":"meeting001","draft":{"likes":"bad"}}]}',
    ]) {
      storage.setItem(MEET_DRAFTS_KEY, value);
      expect(loadMeetDraft('meeting001', storage)).toBeNull();
    }
    const broken = {
      getItem: () => {
        throw new Error('읽기 실패');
      },
      setItem: () => {
        throw new Error('쓰기 실패');
      },
    } as unknown as Storage;
    expect(() => saveMeetDraft('meeting001', draft, broken)).not.toThrow();
    expect(loadMeetDraft('meeting001', broken)).toBeNull();
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('접근 거부');
    });
    expect(() => saveMeetDraft('meeting001', draft)).not.toThrow();
    expect(loadMeetDraft('meeting001')).toBeNull();
  });
});

it('같은 내용의 새 초안에도 다른 버전을 주고 읽기는 버전을 유지한다', () => {
  const storage = createMemoryStorage();
  const first = saveMeetDraft('meeting001', draft, storage);
  expect(first).toEqual(expect.any(String));
  loadMeetDraft('meeting001', storage);
  const raw = JSON.parse(storage.getItem(MEET_DRAFTS_KEY)!);
  expect(raw.drafts[0].version).toBe(first);
  const second = saveMeetDraft('meeting001', draft, storage);
  expect(second).not.toBe(first);
});

it('초안 비교 후 저장과 삭제는 요청 버전만 바꾸고 다른 약속과 새 버전은 보존한다', () => {
  const storage = createMemoryStorage();
  const first = saveMeetDraft('meeting001', draft, storage)!;
  const second = saveMeetDraft('meeting001', draft, storage)!;
  saveMeetDraft('meeting002', draft, storage);
  expect(saveMeetDraft('meeting001', { ...draft, likes: [] }, storage, first)).toBeUndefined();
  expect(removeMeetDraft('meeting001', first, storage)).toBe(false);
  expect(loadMeetDraftEntry('meeting001', storage)?.version).toBe(second);
  expect(removeMeetDraft('meeting001', second, storage)).toBe(true);
  expect(loadMeetDraft('meeting001', storage)).toBeNull();
  expect(loadMeetDraft('meeting002', storage)).toEqual(draft);
});

it('버전 없는 기존 초안은 내용 기준으로 읽고 다음 편집에서 버전을 붙인다', () => {
  const storage = createMemoryStorage();
  storage.setItem(
    MEET_DRAFTS_KEY,
    JSON.stringify({ drafts: [{ meetingId: 'meeting001', draft }] }),
  );
  const before = loadMeetDraftEntry('meeting001', storage)!;
  expect(before.draft).toEqual(draft);
  const version = saveMeetDraft('meeting001', { ...draft, likes: [] }, storage, before.version);
  expect(version).toEqual(expect.any(String));
  expect(removeMeetDraft('meeting001', before.version, storage)).toBe(false);
  expect(loadMeetDraft('meeting001', storage)?.likes).toEqual([]);
});
