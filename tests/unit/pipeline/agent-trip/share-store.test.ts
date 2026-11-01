// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TripFailure } from '../../../../pipeline/agent-trip/errors';
import {
  addShare,
  readShares,
  removeShare,
  reserveShare,
  settleShare,
  SHARE_STORE_MAX,
  withShareStore,
  type StoreDeps,
  type StoredShare,
} from '../../../../pipeline/agent-trip/share-store';

let deps: StoreDeps;
let now: Date;
const item = (): StoredShare => ({
  app: 'http://localhost:8795',
  id: randomBytes(12).toString('base64url'),
  deleteToken: randomBytes(32).toString('base64url'),
  title: '여행',
  createdAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
});
beforeEach(async () => {
  now = new Date();
  deps = { home: await mkdtemp(join(tmpdir(), 'agent-store-')), now: () => now };
});
afterEach(async () => {
  await rm(deps.home, { recursive: true, force: true });
});
async function fill(count: number) {
  await withShareStore(deps, () => ({ items: Array.from({ length: count }, item), result: null }));
}
describe('공유 삭제 토큰 저장소', () => {
  it('파일 없음은 빈 목록이며 추가하면 폴더 700·파일 600으로 보관한다', async () => {
    expect(await readShares(deps)).toEqual([]);
    const share = item();
    await addShare(share, deps);
    expect((await stat(deps.home)).mode & 0o777).toBe(0o700);
    expect((await stat(join(deps.home, 'agent-shares.json'))).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(await readShares(deps)) === JSON.stringify([share])).toBe(true);
  });
  it('기존 폴더 권한 755는 보존하고 파일만 600으로 만든다', async () => {
    await chmod(deps.home, 0o755);
    await addShare(item(), deps);
    expect((await stat(deps.home)).mode & 0o777).toBe(0o755);
    expect((await stat(join(deps.home, 'agent-shares.json'))).mode & 0o777).toBe(0o600);
  });
  it('없던 폴더는 700으로 만든다', async () => {
    const nested = { ...deps, home: join(deps.home, '새 폴더') };
    await addShare(item(), nested);
    expect((await stat(nested.home)).mode & 0o777).toBe(0o700);
  });
  it('삭제 토큰을 가진 예약은 5분 뒤에도 남고 상한에 세며 기한에 만료된다', async () => {
    await fill(199);
    const unknown = { ...item(), id: 'pending:unknown' };
    await addShare(unknown, deps);
    now = new Date(now.getTime() + 300_001);
    expect((await readShares(deps)).some((x) => x.id === unknown.id)).toBe(true);
    expect(await reserveShare(deps, '새 여행')).toBeNull();
    now = new Date(unknown.expiresAt);
    expect(await readShares(deps)).toEqual([]);
  });
  it('만료 항목은 읽기에서 빠지고 같은 app·id만 지운다', async () => {
    const active = item();
    const expired = { ...item(), expiresAt: now.toISOString() };
    await addShare(active, deps);
    await addShare(expired, deps);
    expect((await readShares(deps)).map((x) => x.id)).toEqual([active.id]);
    await removeShare('https://other.example', active.id, deps);
    expect(await readShares(deps)).toHaveLength(1);
    await removeShare(active.app, active.id, deps);
    expect(await readShares(deps)).toEqual([]);
  });
  it('200개면 예약을 거절하고 199개면 한 자리를 예약한다', async () => {
    expect(SHARE_STORE_MAX).toBe(200);
    await fill(200);
    expect(await reserveShare(deps, '새 여행')).toBeNull();
    await fill(199);
    expect(await reserveShare(deps, '새 여행')).toMatch(/^pending:/);
    expect(await reserveShare(deps, '다음 여행')).toBeNull();
    expect(await readShares(deps)).toHaveLength(199);
  });
  it('199개에서 동시 예약은 하나만 성공하고 5분 뒤에는 빈자리로 본다', async () => {
    await fill(199);
    const results = await Promise.all([reserveShare(deps, '가'), reserveShare(deps, '나')]);
    expect(results.filter(Boolean)).toHaveLength(1);
    now = new Date(now.getTime() + 300_001);
    expect(await reserveShare(deps, '다')).toMatch(/^pending:/);
  });
  it('예약을 실제 항목으로 바꾸고 실패한 예약은 지운다', async () => {
    const a = await reserveShare(deps, '가');
    const b = await reserveShare(deps, '나');
    const share = item();
    await settleShare(deps, a!, share);
    await settleShare(deps, b!, null);
    expect((await readShares(deps)).map((x) => x.id)).toEqual([share.id]);
    const raw = JSON.parse(await readFile(join(deps.home, 'agent-shares.json'), 'utf8'));
    expect(raw.items).toHaveLength(1);
  });
  it('동시 추가 10개를 잃지 않는다', async () => {
    const shares = Array.from({ length: 10 }, item);
    await Promise.all(shares.map((x) => addShare(x, deps)));
    expect((await readShares(deps)).map((x) => x.id).sort()).toEqual(
      shares.map((x) => x.id).sort(),
    );
  });
  it('추가와 삭제를 동시에 해도 다른 항목을 잃지 않는다', async () => {
    const a = item();
    const b = item();
    await addShare(a, deps);
    await Promise.all([addShare(b, deps), removeShare(a.app, a.id, deps)]);
    expect((await readShares(deps)).map((x) => x.id)).toEqual([b.id]);
  });
  it('31초 된 잠금을 지우고 진행하며 끝나면 잠금을 남기지 않는다', async () => {
    const lock = join(deps.home, 'agent-shares.lock');
    await writeFile(lock, '');
    const stale = new Date(Date.now() - 31_000);
    await utimes(lock, stale, stale);
    await addShare(item(), deps);
    expect(await readShares(deps)).toHaveLength(1);
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('31초 된 잠금을 동시에 회수해도 추가 8개를 잃지 않는다 (20회 반복)', async () => {
    const lock = join(deps.home, 'agent-shares.lock');
    const takeover = join(deps.home, 'agent-shares.lock.takeover');
    for (let attempt = 0; attempt < 20; attempt++) {
      await rm(join(deps.home, 'agent-shares.json'), { force: true });
      await writeFile(lock, '');
      const stale = new Date(Date.now() - 31_000);
      await utimes(lock, stale, stale);
      const shares = Array.from({ length: 8 }, item);
      await Promise.all(shares.map((share) => addShare(share, deps)));
      expect((await readShares(deps)).sort((a, b) => a.id.localeCompare(b.id))).toEqual(
        shares.sort((a, b) => a.id.localeCompare(b.id)),
      );
      await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(takeover)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });
  it('31초 된 회수 잠금도 지우고 진행하며 두 잠금을 남기지 않는다', async () => {
    const lock = join(deps.home, 'agent-shares.lock');
    const takeover = join(deps.home, 'agent-shares.lock.takeover');
    const stale = new Date(Date.now() - 31_000);
    for (const path of [lock, takeover]) {
      await writeFile(path, '');
      await utimes(path, stale, stale);
    }
    const share = item();
    await addShare(share, deps);
    expect(await readShares(deps)).toEqual([share]);
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(takeover)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('다른 실행이 회수 잠금을 쥐고 있으면 본 잠금을 지우지 않고 기다린다', async () => {
    const lock = join(deps.home, 'agent-shares.lock');
    const takeover = join(deps.home, 'agent-shares.lock.takeover');
    await writeFile(lock, '');
    const stale = new Date(Date.now() - 31_000);
    await utimes(lock, stale, stale);
    const identity = await stat(lock);
    await writeFile(takeover, '');
    const share = item();
    const adding = addShare(share, deps);
    try {
      await sleep(100);
      expect(await stat(lock)).toMatchObject({ ino: identity.ino, dev: identity.dev });
      expect(await readShares(deps)).toEqual([]);
    } finally {
      await rm(takeover, { force: true });
      await adding;
    }
    expect(await readShares(deps)).toEqual([share]);
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(takeover)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each(['json', 'version', 'shape', 'item'])(
    '손상된 %s는 오류로 멈추고 원본 바이트를 보존한다',
    async (kind) => {
      const secret = randomBytes(32).toString('base64url');
      const raw =
        kind === 'json'
          ? `{${secret}`
          : JSON.stringify(
              kind === 'version'
                ? { v: 2, items: [], secret }
                : kind === 'shape'
                  ? { v: 1, items: {}, secret }
                  : { v: 1, items: [{ deleteToken: secret }] },
            );
      const file = join(deps.home, 'agent-shares.json');
      await writeFile(file, raw);
      for (const action of [() => readShares(deps), () => addShare(item(), deps)]) {
        const failure = await action().catch((e: unknown) => e);
        expect(failure instanceof TripFailure).toBe(true);
        expect(failure).toMatchObject({ exit: 1, issues: [{ code: 'share-store' }] });
        expect(String(failure).includes(secret)).toBe(false);
        expect((await readFile(file, 'utf8')) === raw).toBe(true);
      }
    },
  );
});
