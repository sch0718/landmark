import { describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { createHelpSeenStore, HELP_SEEN_KEY } from 'src/services/help-seen';

describe('처음 안내 기록', () => {
  it('기록을 읽고 메뉴를 중복 없이 저장하며 초기화한다', () => {
    const storage = createMemoryStorage();
    storage.setItem(HELP_SEEN_KEY, '["library"]');
    const store = createHelpSeenStore(() => storage);
    expect([...store.read()]).toEqual(['library']);
    store.mark('map');
    store.mark('map');
    expect(JSON.parse(storage.getItem(HELP_SEEN_KEY)!)).toEqual(['library', 'map']);
    store.reset();
    expect(storage.getItem(HELP_SEEN_KEY)).toBeNull();
    expect(store.read().size).toBe(0);
  });
  it.each(['broken', '{}', '[1]', '["unknown"]', 'null'])('손상된 값 %s를 무시한다', (value) => {
    const storage = createMemoryStorage();
    storage.setItem(HELP_SEEN_KEY, value);
    expect(createHelpSeenStore(() => storage).read().size).toBe(0);
  });
  it('모르는 메뉴 이름만 빼고 아는 기록은 남긴다', () => {
    const storage = createMemoryStorage();
    storage.setItem(HELP_SEEN_KEY, '["library","future",3]');
    expect([...createHelpSeenStore(() => storage).read()]).toEqual(['library']);
  });
  it('깨진 값이 있어도 새 기록은 저장소에 남는다', () => {
    const storage = createMemoryStorage();
    storage.setItem(HELP_SEEN_KEY, 'broken');
    createHelpSeenStore(() => storage).mark('map');
    expect(JSON.parse(storage.getItem(HELP_SEEN_KEY)!)).toEqual(['map']);
    expect([...createHelpSeenStore(() => storage).read()]).toEqual(['map']);
  });
  it('저장소 접근 실패 시 페이지 메모리에 기록한다', () => {
    const store = createHelpSeenStore(() => {
      throw new Error('차단');
    });
    expect(store.read().size).toBe(0);
    store.mark('library');
    expect(store.read().has('library')).toBe(true);
    store.reset();
    expect(store.read().size).toBe(0);
  });
  it('쓰기 실패 시 읽었던 값과 새 기록을 모두 기억한다', () => {
    const storage = createMemoryStorage();
    storage.setItem(HELP_SEEN_KEY, '["map"]');
    const store = createHelpSeenStore(() => storage);
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('용량');
    });
    store.mark('library');
    expect([...store.read()]).toEqual(['map', 'library']);
    vi.spyOn(storage, 'removeItem').mockImplementation(() => {
      throw new Error('차단');
    });
    store.reset();
    expect(store.read().size).toBe(0);
  });
});
