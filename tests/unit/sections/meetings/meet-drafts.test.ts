import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMeetDraft, saveMeetDraft, MEET_DRAFTS_KEY } from 'src/sections/meetings/meet-drafts';
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
