/** localStorage 키(§5.1). */
export function storageKey(publicId: string): string {
  return `tripmap:edit:${publicId}`;
}

export const PROBE_KEY = 'tripmap:probe';

/** 실제로 쓰고 지워 본다. 사파리 사생활 보호 모드·용량 초과 등에서는 false. */
export function isStorageAvailable(storage: Storage | undefined): storage is Storage {
  if (!storage) return false;
  try {
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

class MemoryStorage implements Storage {
  readonly #items = new Map<string, string>();
  [name: string]: unknown;

  get length(): number {
    return this.#items.size;
  }

  clear(): void {
    this.#items.clear();
  }

  getItem(key: string): string | null {
    return this.#items.get(String(key)) ?? null;
  }

  key(index: number): string | null {
    return [...this.#items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#items.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.#items.set(String(key), String(value));
  }
}

/** localStorage를 쓸 수 없을 때 쓰는 메모리 대체 저장소. 새로고침하면 사라진다. */
export function createMemoryStorage(): Storage {
  return new MemoryStorage();
}

/** 스키마 마이그레이션 체인의 자리(§5.1). PoC에는 v1만 있으므로 그대로 반환한다. */
export function migrateEditLayer(raw: unknown): unknown {
  return raw;
}
