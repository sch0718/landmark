import {
  assertEditLayerSize,
  EDIT_LAYER_PARSE,
  EditLayerSchema,
  type EditLayer,
} from 'src/schema/legacy/edit-layer';
import { parseOrThrow, safeParse } from 'src/schema/parse';

/** localStorage 키(§5.1). */
export function storageKey(publicId: string): string {
  return `tripmap:edit:${publicId}`;
}

const PROBE_KEY = 'tripmap:probe';

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

/** 중단으로 끝난 작업의 오류(`DOMException` `AbortError`)인지. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('편집 저장을 취소했어요', 'AbortError');
}

/**
 * 같은 여행의 EditLayer 쓰기를 탭 사이에서 직렬화한다. Web Locks가 없는 브라우저에서는
 * 잠금 없이 실행한다(탭 간 경합 가능 — README의 한계 참고).
 *
 * `signal`이 중단되면 잠금 획득 전이면 Web Locks가 AbortError로 거부하고, 잠금을 얻은 뒤
 * (또는 잠금 없이) 실행 직전에 이미 중단됐으면 `fn`을 부르지 않고 AbortError를 던진다.
 */
export async function withEditLock<T>(
  publicId: string,
  deps: { locks?: LockManager; signal?: AbortSignal },
  fn: () => T | Promise<T>,
): Promise<T> {
  const { locks, signal } = deps;
  const run = () => {
    throwIfAborted(signal);
    return fn();
  };
  if (!locks) return run();
  const name = storageKey(publicId);
  if (!signal) return locks.request(name, run) as Promise<T>;
  throwIfAborted(signal);
  return locks.request(name, { signal }, run) as Promise<T>;
}

/** 스키마 마이그레이션 체인의 자리(§5.1). PoC에는 v1만 있으므로 그대로 반환한다. */
export function migrateEditLayer(raw: unknown): unknown {
  return raw;
}

export type ReadEditLayerResult = {
  edit: EditLayer | null;
  raw: string | null;
  corruptBackedUp: boolean;
};

/**
 * 저장된 레이어를 읽는다. 해석·마이그레이션·검증에 실패하거나 아는 것보다 새 `schemaVersion`이면
 * 원문을 `…:corrupt:<now>`로 백업하고 원래 키를 지운다. 성공 시 `raw`는 저장된 원문 그대로다.
 */
export function readEditLayer(
  storage: Storage,
  publicId: string,
  now: number,
): ReadEditLayerResult {
  const key = storageKey(publicId);
  const raw = storage.getItem(key);
  if (raw === null) return { edit: null, raw: null, corruptBackedUp: false };

  const edit = parseStored(raw);
  if (edit) return { edit, raw, corruptBackedUp: false };

  storage.setItem(`${key}:corrupt:${now}`, raw);
  // 잠금 밖에서 실행될 수 있으므로, 그사이 다른 탭이 쓴 값은 지우지 않는다.
  if (storage.getItem(key) === raw) storage.removeItem(key);
  return { edit: null, raw: null, corruptBackedUp: true };
}

function parseStored(raw: string): EditLayer | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value === 'object' && value !== null) {
    const version = (value as { schemaVersion?: unknown }).schemaVersion;
    if (typeof version === 'number' && version > 1) return null;
  }
  let migrated: unknown;
  try {
    migrated = migrateEditLayer(value);
  } catch {
    return null;
  }
  const parsed = safeParse(EditLayerSchema, migrated, EDIT_LAYER_PARSE);
  return parsed.success ? parsed.data : null;
}

export function writeEditLayer(storage: Storage, edit: EditLayer): void {
  storage.setItem(storageKey(edit.publicId), JSON.stringify(edit));
}

/**
 * 앱에서 EditLayer를 저장하는 유일한 편집 경로(가져오기는 `commitImport`).
 * 잠금 안에서 저장소의 최신 레이어를 다시 읽어(없으면 null) `fn`을 적용하고, 결과를 검증한 뒤 쓴다.
 * 검증(스키마·크기 제한) 실패는 throw하고 아무것도 쓰지 않는다. 저장소 예외도 그대로 전파한다.
 */
export async function updateEditLayer(
  publicId: string,
  fn: (current: EditLayer | null) => EditLayer,
  deps: { storage: Storage; locks?: LockManager; now: () => number },
): Promise<EditLayer> {
  return withEditLock(publicId, deps, () => {
    const { edit: current } = readEditLayer(deps.storage, publicId, deps.now());
    const next = fn(current);
    parseOrThrow(EditLayerSchema, next, EDIT_LAYER_PARSE);
    // 내보낼 수 없는 크기로 자라지 않게 막는다(§5.3 크기 제한).
    assertEditLayerSize(next);
    deps.storage.setItem(storageKey(publicId), JSON.stringify(next));
    return next;
  });
}
