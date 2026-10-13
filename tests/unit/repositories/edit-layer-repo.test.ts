import { describe, expect, it } from 'vitest';
import {
  createMemoryStorage,
  isStorageAvailable,
  storageKey,
} from 'src/repositories/edit-layer-repo';

describe('storageKey', () => {
  it('tripmap:edit:<publicId>', () => {
    expect(storageKey('testtrip0001')).toBe('tripmap:edit:testtrip0001');
  });
});

describe('createMemoryStorage', () => {
  it('Storage 인터페이스를 문자열 값으로 구현한다', () => {
    const s = createMemoryStorage();
    expect(s.length).toBe(0);
    s.setItem('a', '1');
    s.setItem('b', 2 as unknown as string);
    expect(s.getItem('a')).toBe('1');
    expect(s.getItem('b')).toBe('2');
    expect(s.getItem('none')).toBeNull();
    expect(s.length).toBe(2);
    expect([s.key(0), s.key(1)].sort()).toEqual(['a', 'b']);
    expect(s.key(5)).toBeNull();
    s.removeItem('a');
    expect(s.getItem('a')).toBeNull();
    expect(s.length).toBe(1);
    s.clear();
    expect(s.length).toBe(0);
  });
});

describe('isStorageAvailable', () => {
  it('setItem이 throw하면 false', () => {
    const s = createMemoryStorage();
    s.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    expect(isStorageAvailable(s)).toBe(false);
  });

  it('undefined면 false', () => {
    expect(isStorageAvailable(undefined)).toBe(false);
  });

  it('쓰기·삭제가 되면 true이고 흔적을 남기지 않는다', () => {
    const s = createMemoryStorage();
    expect(isStorageAvailable(s)).toBe(true);
    expect(s.length).toBe(0);
    expect(isStorageAvailable(window.localStorage)).toBe(true);
  });
});
