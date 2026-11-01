import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { SHORT_ID_PATTERN } from 'src/domain/share/short-link';
import { EXIT, TripFailure } from './errors';

export type StoredShare = {
  app: string;
  id: string;
  deleteToken: string;
  title: string;
  createdAt: string;
  expiresAt: string;
};
export type StoreDeps = { home: string; now(): Date };
export const SHARE_STORE_MAX = 200;
export const PENDING_SHARE_PATTERN = /^pending:[A-Za-z0-9_-]+$/;
const DELETE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PENDING_MS = 5 * 60_000;
const pending = (item: StoredShare) => item.id.startsWith('pending:');
function failure(): TripFailure {
  return new TripFailure(
    [{ path: '', code: 'share-store', message: '공유 링크 저장 파일을 읽거나 쓰지 못했어요' }],
    EXIT.internal,
  );
}
function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
function validItem(value: unknown): value is StoredShare {
  if (!value || typeof value !== 'object') return false;
  const x = value as Record<string, unknown>;
  if (
    !['app', 'id', 'deleteToken', 'title', 'createdAt', 'expiresAt'].every(
      (k) => typeof x[k] === 'string',
    )
  )
    return false;
  const item = value as StoredShare;
  if (![item.createdAt, item.expiresAt].every((s) => Number.isFinite(Date.parse(s)))) return false;
  return pending(item)
    ? PENDING_SHARE_PATTERN.test(item.id) &&
        (item.deleteToken === '' ||
          (item.app.length > 0 && DELETE_TOKEN_PATTERN.test(item.deleteToken)))
    : item.app.length > 0 &&
        SHORT_ID_PATTERN.test(item.id) &&
        DELETE_TOKEN_PATTERN.test(item.deleteToken);
}
async function readItems(deps: StoreDeps): Promise<StoredShare[]> {
  let text: string;
  try {
    text = await readFile(join(deps.home, 'agent-shares.json'), 'utf8');
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return [];
    throw failure();
  }
  try {
    const data = JSON.parse(text);
    if (!data || data.v !== 1 || !Array.isArray(data.items) || !data.items.every(validItem))
      throw failure();
    const now = deps.now().getTime();
    return (data.items as StoredShare[]).filter(
      (item) =>
        Date.parse(item.expiresAt) > now &&
        (!pending(item) ||
          item.deleteToken !== '' ||
          Date.parse(item.createdAt) + PENDING_MS > now),
    );
  } catch {
    throw failure();
  }
}
export async function readShares(deps: StoreDeps): Promise<StoredShare[]> {
  return (await readItems(deps)).filter((item) => !pending(item) || item.deleteToken !== '');
}
/** 읽기·수정·원자적 교체를 한 잠금 안에서 처리한다. */
export async function withShareStore<T>(
  deps: StoreDeps,
  edit: (items: StoredShare[]) => { items: StoredShare[]; result: T },
): Promise<T> {
  const lockPath = join(deps.home, 'agent-shares.lock');
  const takeoverPath = `${lockPath}.takeover`;
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  let identity: Awaited<ReturnType<typeof stat>> | undefined;
  let temporary: string | undefined;
  try {
    const created = await mkdir(deps.home, { recursive: true, mode: 0o700 });
    if (created !== undefined) await chmod(deps.home, 0o700);
    const started = Date.now();
    for (;;) {
      try {
        lock = await open(lockPath, 'wx', 0o600);
        identity = await lock.stat();
        break;
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error;
        try {
          const abandoned = await stat(lockPath);
          if (Date.now() - abandoned.mtimeMs > 30_000) {
            let takeover: Awaited<ReturnType<typeof open>> | undefined;
            let takeoverIdentity: Awaited<ReturnType<typeof stat>> | undefined;
            let reclaimed = false;
            try {
              takeover = await open(takeoverPath, 'wx', 0o600);
              takeoverIdentity = await takeover.stat();
              const current = await stat(lockPath);
              if (
                current.ino === abandoned.ino &&
                current.dev === abandoned.dev &&
                Date.now() - current.mtimeMs > 30_000
              ) {
                await unlink(lockPath);
                reclaimed = true;
              }
            } catch (e) {
              if (!hasCode(e, 'EEXIST')) throw e;
              const abandonedTakeover = await stat(takeoverPath);
              if (Date.now() - abandonedTakeover.mtimeMs > 30_000) {
                // 회수 잠금은 몇 ms만 쥐므로 죽은 실행의 잠금을 지우는 경합은 사실상 생기지 않는다.
                await unlink(takeoverPath);
              }
            } finally {
              if (takeover) {
                await takeover.close();
                try {
                  const current = await stat(takeoverPath);
                  if (current.ino === takeoverIdentity?.ino && current.dev === takeoverIdentity.dev)
                    await unlink(takeoverPath);
                } catch {
                  /* 다른 실행에서 이미 정리한 회수 잠금은 남기지 않는다. */
                }
              }
            }
            if (reclaimed) continue;
          }
        } catch (e) {
          if (hasCode(e, 'ENOENT')) continue;
          throw e;
        }
        if (Date.now() - started >= 5_000) throw failure();
        await sleep(50);
      }
    }
    const { items, result } = edit(await readItems(deps));
    temporary = join(deps.home, `agent-shares.json.${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify({ v: 1, items }) + '\n', 'utf8');
      await handle.chmod(0o600);
    } finally {
      await handle.close();
    }
    await rename(temporary, join(deps.home, 'agent-shares.json'));
    return result;
  } catch {
    throw failure();
  } finally {
    if (temporary) await unlink(temporary).catch(() => undefined);
    if (lock) {
      await lock.close();
      try {
        const current = await stat(lockPath);
        if (current.ino === identity?.ino && current.dev === identity.dev) await unlink(lockPath);
      } catch {
        /* 다른 실행에서 이미 정리한 잠금은 남기지 않는다. */
      }
    }
  }
}
export async function reserveShare(
  deps: StoreDeps,
  title: string,
  recovery?: Pick<StoredShare, 'app' | 'deleteToken' | 'expiresAt'>,
): Promise<string | null> {
  return withShareStore(deps, (items) => {
    if (items.length >= SHARE_STORE_MAX) return { items, result: null };
    const id = 'pending:' + randomUUID();
    const now = deps.now();
    return {
      items: [
        ...items,
        {
          app: '',
          id,
          deleteToken: '',
          title,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + PENDING_MS).toISOString(),
          ...recovery,
        },
      ],
      result: id,
    };
  });
}
export async function settleShare(
  deps: StoreDeps,
  reservation: string,
  item: StoredShare | null,
): Promise<void> {
  return withShareStore(deps, (items) => {
    if (item !== null && !items.some((x) => x.id === reservation)) throw failure();
    return {
      items: items.flatMap((x) => (x.id === reservation ? (item === null ? [] : [item]) : [x])),
      result: undefined,
    };
  });
}
export async function addShare(item: StoredShare, deps: StoreDeps): Promise<void> {
  return withShareStore(deps, (items) => ({
    items: [...items.filter((x) => x.app !== item.app || x.id !== item.id), item],
    result: undefined,
  }));
}
export async function removeShare(app: string, id: string, deps: StoreDeps): Promise<void> {
  return withShareStore(deps, (items) => ({
    items: items.filter((x) => x.app !== app || x.id !== id),
    result: undefined,
  }));
}
