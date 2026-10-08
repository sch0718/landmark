import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryStorage,
  isStorageAvailable,
  readEditLayer,
  storageKey,
  updateEditLayer,
  withEditLock,
  writeEditLayer,
} from 'src/repositories/edit-layer-repo';
import type { EditLayer } from 'src/schema/legacy/edit-layer';
import { makeEdit, withBulkyMemos } from '../../fixtures/builders';

const PID = 'testtrip0001';
const KEY = 'tripmap:edit:testtrip0001';
const T1 = '2026-10-03T00:10:00.000Z';
const NOW_MS = 1759450000000;

const withMemo = (edit: EditLayer, placeKey: string, text: string): EditLayer => ({
  ...edit,
  places: {
    ...edit.places,
    [placeKey]: { memos: { [edit.authorId]: { text, updatedAt: T1 } } },
  },
});

function fakeLocks() {
  const names: string[] = [];
  const locks = {
    request: (name: string, cb: (lock: { name: string; mode: string }) => unknown) => {
      names.push(name);
      return Promise.resolve(cb({ name, mode: 'exclusive' }));
    },
  } as unknown as LockManager;
  return { locks, names };
}

describe('storageKey', () => {
  it('tripmap:edit:<publicId>', () => {
    expect(storageKey(PID)).toBe(KEY);
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

describe('readEditLayer / writeEditLayer', () => {
  beforeEach(() => window.localStorage.clear());

  it('키가 없으면 edit·raw 모두 null', () => {
    expect(readEditLayer(window.localStorage, PID, NOW_MS)).toEqual({
      edit: null,
      raw: null,
      corruptBackedUp: false,
    });
  });

  it('저장한 레이어를 읽고 raw는 저장된 원문 그대로', () => {
    const edit = withMemo(makeEdit(), 'n:1', '메모');
    writeEditLayer(window.localStorage, edit);
    const raw = window.localStorage.getItem(KEY);
    expect(raw).toBe(JSON.stringify(edit));
    expect(readEditLayer(window.localStorage, PID, NOW_MS)).toEqual({
      edit,
      raw,
      corruptBackedUp: false,
    });
  });

  it('깨진 문자열은 백업 키에 원문을 두고 원래 키를 지운다', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(readEditLayer(window.localStorage, PID, NOW_MS)).toEqual({
      edit: null,
      raw: null,
      corruptBackedUp: true,
    });
    expect(window.localStorage.getItem(`${KEY}:corrupt:${NOW_MS}`)).toBe('{not json');
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('스키마 위반도 손상으로 백업한다', () => {
    const raw = JSON.stringify({ ...makeEdit(), authorId: '' });
    window.localStorage.setItem(KEY, raw);
    const result = readEditLayer(window.localStorage, PID, NOW_MS);
    expect(result.corruptBackedUp).toBe(true);
    expect(window.localStorage.getItem(`${KEY}:corrupt:${NOW_MS}`)).toBe(raw);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('schemaVersion이 1보다 크면 손상으로 백업한다', () => {
    const raw = JSON.stringify({ ...makeEdit(), schemaVersion: 2 });
    window.localStorage.setItem(KEY, raw);
    const result = readEditLayer(window.localStorage, PID, NOW_MS);
    expect(result).toEqual({ edit: null, raw: null, corruptBackedUp: true });
    expect(window.localStorage.getItem(`${KEY}:corrupt:${NOW_MS}`)).toBe(raw);
  });

  it('정리 직전에 다른 탭이 유효한 레이어를 썼으면 키를 지우지 않는다', () => {
    const storage = createMemoryStorage();
    storage.setItem(KEY, '{not json');
    const valid = JSON.stringify(withMemo(makeEdit(), 'n:1', '다른 탭'));
    const realGet = storage.getItem.bind(storage);
    let reads = 0;
    storage.getItem = (key: string) => {
      const value = realGet(key);
      if (key === KEY && ++reads === 1) storage.setItem(KEY, valid); // 첫 읽기 직후 다른 탭이 씀
      return value;
    };

    const result = readEditLayer(storage, PID, NOW_MS);

    expect(result).toEqual({ edit: null, raw: null, corruptBackedUp: true });
    expect(realGet(`${KEY}:corrupt:${NOW_MS}`)).toBe('{not json');
    expect(realGet(KEY)).toBe(valid);
  });
});

describe('withEditLock', () => {
  it('locks가 있으면 tripmap:edit:<publicId> 이름으로 요청한다', async () => {
    const { locks, names } = fakeLocks();
    const spy = vi.spyOn(locks, 'request');
    await expect(withEditLock(PID, { locks }, () => 42)).resolves.toBe(42);
    expect(names).toEqual([KEY]);
    expect(spy.mock.calls[0]).toHaveLength(2);
  });

  it('locks가 없으면 fn을 그대로 실행한다', async () => {
    await expect(withEditLock(PID, {}, async () => 'ok')).resolves.toBe('ok');
  });

  it('updateEditLayer는 tripmap:edit:<publicId> 잠금 안에서 쓴다', async () => {
    const { locks, names } = fakeLocks();
    await updateEditLayer(PID, (current) => current ?? makeEdit(), {
      storage: createMemoryStorage(),
      locks,
      now: () => NOW_MS,
    });
    expect(names).toEqual([KEY]);
  });
});

describe.each([
  ['locks 있음', () => fakeLocks().locks],
  ['locks 없음', () => undefined],
])('updateEditLayer (%s)', (_label, makeLocks) => {
  let storage: Storage;
  const now = () => NOW_MS;

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  it('오래된 화면에서 편집해도 저장소의 최신 레이어 위에 적용한다', async () => {
    const l0 = makeEdit();
    writeEditLayer(storage, l0);
    // 다른 탭이 p1 메모를 저장했다.
    const l1 = withMemo(l0, 'n:1', 'p1 메모');
    writeEditLayer(storage, l1);

    const result = await updateEditLayer(
      PID,
      (current) => withMemo(current ?? l0, 'n:2', 'p2 메모'),
      {
        storage,
        locks: makeLocks(),
        now,
      },
    );

    const stored = readEditLayer(storage, PID, NOW_MS).edit!;
    expect(stored).toEqual(result);
    expect(stored.places['n:1']?.memos['a-local']?.text).toBe('p1 메모');
    expect(stored.places['n:2']?.memos['a-local']?.text).toBe('p2 메모');
  });

  it('저장소가 비어 있으면 fn이 null을 받는다', async () => {
    const draft = makeEdit();
    const fn = vi.fn((current: EditLayer | null) => current ?? draft);
    await updateEditLayer(PID, fn, { storage, locks: makeLocks(), now });
    expect(fn).toHaveBeenCalledWith(null);
    expect(storage.getItem(KEY)).toBe(JSON.stringify(draft));
  });

  it('그사이 다른 레이어가 저장됐으면 draft로 덮지 않는다', async () => {
    const draft = makeEdit({
      authorId: 'a-draft',
      authors: { 'a-draft': { nickname: '새', updatedAt: T1 } },
    });
    const existing = withMemo(makeEdit(), 'n:1', '기존');
    writeEditLayer(storage, existing);
    const result = await updateEditLayer(PID, (current) => current ?? draft, {
      storage,
      locks: makeLocks(),
      now,
    });
    expect(result).toEqual(existing);
    expect(readEditLayer(storage, PID, NOW_MS).edit).toEqual(existing);
  });

  it('fn 결과가 스키마 위반이면 throw하고 쓰지 않는다', async () => {
    const l0 = makeEdit();
    writeEditLayer(storage, l0);
    const before = storage.getItem(KEY);
    await expect(
      updateEditLayer(PID, (current) => ({ ...(current ?? l0), authorId: '' }), {
        storage,
        locks: makeLocks(),
        now,
      }),
    ).rejects.toThrow();
    expect(storage.getItem(KEY)).toBe(before);
  });

  it('fn 결과가 1MB(내보내기 파일 기준)를 넘으면 throw하고 쓰지 않는다', async () => {
    const l0 = withBulkyMemos(makeEdit(), 1001, 90);
    writeEditLayer(storage, l0);
    const before = storage.getItem(KEY);
    await expect(
      updateEditLayer(PID, (current) => withBulkyMemos(current ?? l0, 2001, 90), {
        storage,
        locks: makeLocks(),
        now,
      }),
    ).rejects.toThrow('1MB');
    expect(storage.getItem(KEY)).toBe(before);
  });

  it('저장소 쓰기 예외는 그대로 전파한다', async () => {
    storage.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    await expect(
      updateEditLayer(PID, (current) => current ?? makeEdit(), {
        storage,
        locks: makeLocks(),
        now,
      }),
    ).rejects.toThrow('quota');
  });
});
