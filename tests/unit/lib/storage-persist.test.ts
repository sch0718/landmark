import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StorageStub = { persisted?: () => Promise<boolean>; persist?: () => Promise<boolean> };

function stubStorage(storage: StorageStub | undefined) {
  vi.stubGlobal('navigator', { storage });
}

/** 모듈 변수(세션당 한 번)를 초기화하려고 매번 새로 불러온다. */
const load = async () => {
  vi.resetModules();
  return import('src/lib/storage-persist');
};

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('persistState', () => {
  it('navigator.storage가 없으면 unsupported', async () => {
    stubStorage(undefined);
    expect(await (await load()).persistState()).toBe('unsupported');
  });

  it('persisted() 결과를 옮긴다', async () => {
    stubStorage({ persisted: async () => true });
    expect(await (await load()).persistState()).toBe('persisted');
    stubStorage({ persisted: async () => false });
    expect(await (await load()).persistState()).toBe('not-persisted');
  });

  it('던지면 unsupported', async () => {
    stubStorage({
      persisted: async () => {
        throw new Error('x');
      },
    });
    expect(await (await load()).persistState()).toBe('unsupported');
  });
});

describe('requestPersistOnce', () => {
  it('persisted()가 거짓이면 persist()를 한 번만 부른다', async () => {
    const persist = vi.fn(async () => true);
    stubStorage({ persisted: async () => false, persist });
    const { requestPersistOnce } = await load();
    expect(await requestPersistOnce()).toBe('persisted');
    await requestPersistOnce();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('persist()가 거절되면 not-persisted', async () => {
    const persist = vi.fn(async () => false);
    stubStorage({ persisted: async () => false, persist });
    expect(await (await load()).requestPersistOnce()).toBe('not-persisted');
  });

  it('persisted()가 참이면 부르지 않는다', async () => {
    const persist = vi.fn(async () => true);
    stubStorage({ persisted: async () => true, persist });
    expect(await (await load()).requestPersistOnce()).toBe('persisted');
    expect(persist).not.toHaveBeenCalled();
  });

  it('지원하지 않으면 unsupported, 던지면 unsupported', async () => {
    stubStorage(undefined);
    expect(await (await load()).requestPersistOnce()).toBe('unsupported');
    stubStorage({
      persisted: async () => false,
      persist: async () => {
        throw new Error('x');
      },
    });
    expect(await (await load()).requestPersistOnce()).toBe('unsupported');
  });
});
