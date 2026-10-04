import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeEditLayer } from 'src/domain/codec';
import { readEditLayer, storageKey, writeEditLayer } from 'src/repositories/edit-layer-repo';
import { commitImport, prepareImport, type PreparedImport } from 'src/repositories/import-flow';
import type { TripLoadResult } from 'src/repositories/trip-repo';
import { LIMITS } from 'src/schema/common';
import type { EditLayer } from 'src/schema/edit-layer';
import type { TripData } from 'src/schema/trip-data';
import { makeEdit, makeTrip, withBulkyMemos } from '../../fixtures/builders';
import { createHeldLocks } from '../../fixtures/fake-locks';

const PID = 'testtrip0001';
const KEY = storageKey(PID);
const T1 = '2026-10-03T00:10:00.000Z';
const T2 = '2026-10-03T00:20:00.000Z';
const NEWER = '2026-10-05T00:00:00.000Z';
const NOW = '2026-10-03T01:00:00.000Z';
const NOW_MS = 1759453200000;

const trip: TripData = makeTrip({ days: { '2026-11-14': ['A', 'B'], '2026-11-15': ['C'] } });

const memo = (edit: EditLayer, placeKey: string, text: string, at = T1): EditLayer => ({
  ...edit,
  places: {
    ...edit.places,
    [placeKey]: {
      memos: { ...edit.places[placeKey]?.memos, [edit.authorId]: { text, updatedAt: at } },
    },
  },
});

const friend = (overrides: Partial<EditLayer> = {}): EditLayer =>
  makeEdit({
    authorId: 'a-friend',
    authors: { 'a-friend': { nickname: '친구', updatedAt: T1 } },
    ...overrides,
  });

const locks = {
  request: (name: string, cb: (lock: { name: string; mode: string }) => unknown) =>
    Promise.resolve(cb({ name, mode: 'exclusive' })),
} as unknown as LockManager;

const noRefetch = (): Promise<TripLoadResult> =>
  Promise.reject(new Error('refetch should not be called'));

const linkOf = async (edit: unknown) => ({
  kind: 'link' as const,
  value: await encodeEditLayer(edit as EditLayer),
});

function expectOk(result: Awaited<ReturnType<typeof prepareImport>>): PreparedImport {
  if (!result.ok) throw new Error(`prepare failed: ${result.reason}`);
  return result.prepared;
}

describe('prepareImport — 입력 검사', () => {
  const ctx = { trip, local: makeEdit(), localSnapshot: null, refetchTrip: noRefetch };

  it('링크 길이 초과는 too-long', async () => {
    const result = await prepareImport(
      { kind: 'link', value: 'a'.repeat(LIMITS.linkChars + 1) },
      ctx,
    );
    expect(result).toEqual({
      ok: false,
      reason: 'too-long',
      message: '가져오기 데이터가 너무 커요',
    });
  });

  it('해제할 수 없는 링크는 corrupt', async () => {
    const result = await prepareImport({ kind: 'link', value: 'zzzz' }, ctx);
    expect(result).toEqual({
      ok: false,
      reason: 'corrupt',
      message: '가져오기 데이터가 손상됐어요',
    });
  });

  it('1MB 초과 파일은 읽기 전에 too-large', async () => {
    const text = vi.fn();
    const file = { size: LIMITS.fileBytes + 1, text } as unknown as Blob;
    const result = await prepareImport({ kind: 'file', file }, ctx);
    expect(result).toEqual({
      ok: false,
      reason: 'too-large',
      message: '가져오기 데이터가 너무 커요',
    });
    expect(text).not.toHaveBeenCalled();
  });

  it('실제 1MB 초과 Blob도 too-large', async () => {
    const file = new Blob(['x'.repeat(LIMITS.fileBytes + 1)]);
    const result = await prepareImport({ kind: 'file', file }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-large');
  });

  it('JSON이 아닌 파일은 corrupt', async () => {
    const result = await prepareImport({ kind: 'file', file: new Blob(['{not json']) }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('corrupt');
  });

  it('스키마 위반은 invalid', async () => {
    const file = new Blob([JSON.stringify({ ...friend(), authorId: '' })]);
    const result = await prepareImport({ kind: 'file', file }, ctx);
    expect(result).toEqual({
      ok: false,
      reason: 'invalid',
      message: '가져오기 데이터가 손상됐어요',
    });
  });

  it('다른 publicId는 other-trip', async () => {
    const result = await prepareImport(await linkOf(friend({ publicId: 'othertrip0001' })), ctx);
    expect(result).toEqual({ ok: false, reason: 'other-trip', message: '다른 여행의 편집이에요' });
  });

  it('local의 publicId가 trip과 다르면 other-trip', async () => {
    const result = await prepareImport(await linkOf(friend()), {
      ...ctx,
      local: makeEdit({ publicId: 'othertrip0001' }),
    });
    expect(result).toEqual({ ok: false, reason: 'other-trip', message: '다른 여행의 편집이에요' });
  });

  it('파일 입력도 정상적으로 준비한다', async () => {
    const incoming = memo(friend(), 'n:2', '친구 메모');
    const prepared = expectOk(
      await prepareImport({ kind: 'file', file: new Blob([JSON.stringify(incoming)]) }, ctx),
    );
    expect(prepared.incoming.places['n:2']?.memos['a-friend']?.text).toBe('친구 메모');
    expect(prepared.tripRefreshed).toBe(false);
    expect(prepared.trip).toBe(trip);
  });
});

describe('prepareImport — 원본 버전 맞추기', () => {
  it('incoming 기준이 더 새로우면 refetchTrip을 부르고 새 trip으로 진행한다', async () => {
    const newTrip: TripData = { ...trip, dataVersion: NEWER };
    const refetchTrip = vi.fn(() => Promise.resolve<TripLoadResult>({ ok: true, trip: newTrip }));
    const local = memo(makeEdit(), 'n:99', '고아 메모');
    const incoming = friend({ baseDataVersion: NEWER });

    const prepared = expectOk(
      await prepareImport(await linkOf(incoming), {
        trip,
        local,
        localSnapshot: null,
        refetchTrip,
      }),
    );

    expect(refetchTrip).toHaveBeenCalledTimes(1);
    expect(prepared.tripRefreshed).toBe(true);
    expect(prepared.trip).toBe(newTrip);
    expect(prepared.local.baseDataVersion).toBe(NEWER);
    expect(prepared.local.places['n:99']?.memos['a-local']?.text).toBe('고아 메모');
  });

  it('다시 받아도 오래됐으면 trip-stale이고 local은 그대로', async () => {
    const refetchTrip = vi.fn(() => Promise.resolve<TripLoadResult>({ ok: true, trip }));
    const local = memo(makeEdit(), 'n:1', '내 메모');
    const before = structuredClone(local);

    const result = await prepareImport(await linkOf(friend({ baseDataVersion: NEWER })), {
      trip,
      local,
      localSnapshot: null,
      refetchTrip,
    });

    expect(refetchTrip).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      reason: 'trip-stale',
      message: '최신 여행 데이터가 아직 반영되지 않았어요. 잠시 후 다시 시도하세요.',
    });
    expect(local).toEqual(before);
  });

  it('다시 받기에 실패해도 trip-stale', async () => {
    const refetchTrip = () =>
      Promise.resolve<TripLoadResult>({ ok: false, kind: 'invalid', message: 'HTTP 500' });
    const result = await prepareImport(await linkOf(friend({ baseDataVersion: NEWER })), {
      trip,
      local: makeEdit(),
      localSnapshot: null,
      refetchTrip,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('trip-stale');
  });

  it('incoming 기준이 같거나 오래되면 refetchTrip을 부르지 않는다', async () => {
    const refetchTrip = vi.fn(noRefetch);
    const prepared = expectOk(
      await prepareImport(await linkOf(friend()), {
        trip,
        local: makeEdit(),
        localSnapshot: null,
        refetchTrip,
      }),
    );
    expect(refetchTrip).not.toHaveBeenCalled();
    expect(prepared.tripRefreshed).toBe(false);
  });
});

describe('prepareImport — 정리', () => {
  it('고아 PlaceEdit은 prepared.local에 유지된다', async () => {
    const local = memo(makeEdit(), 'n:99', '고아 메모');
    const prepared = expectOk(
      await prepareImport(await linkOf(friend()), {
        trip,
        local,
        localSnapshot: 'snap',
        refetchTrip: noRefetch,
      }),
    );
    expect(prepared.local.places['n:99']?.memos['a-local']?.text).toBe('고아 메모');
    expect(prepared.localSnapshot).toBe('snap');
  });

  it('incoming을 현재 trip 기준으로 정리하고 정리 내역을 남긴다', async () => {
    const incoming = memo(friend(), 'n:77', '없는 장소');
    const prepared = expectOk(
      await prepareImport(await linkOf(incoming), {
        trip,
        local: makeEdit(),
        localSnapshot: null,
        refetchTrip: noRefetch,
      }),
    );
    expect(prepared.incomingReport.orphanPlaceKeys).toEqual(['n:77']);
    expect(prepared.plan.conflicts).toEqual([]);
  });
});

describe('commitImport', () => {
  beforeEach(() => window.localStorage.clear());
  const storage = () => window.localStorage;

  async function prepareFromStorage(
    incoming: EditLayer,
    fallback: EditLayer,
  ): Promise<PreparedImport> {
    const { edit, raw } = readEditLayer(storage(), PID, NOW_MS);
    return expectOk(
      await prepareImport(await linkOf(incoming), {
        trip,
        local: edit ?? fallback,
        localSnapshot: raw,
        refetchTrip: noRefetch,
      }),
    );
  }

  it('trip.publicId 기준 tripmap:edit:<publicId> 잠금·키를 쓴다', async () => {
    const names: string[] = [];
    const recording = {
      request: (name: string, cb: (lock: { name: string; mode: string }) => unknown) => {
        names.push(name);
        return Promise.resolve(cb({ name, mode: 'exclusive' }));
      },
    } as unknown as LockManager;
    const prepared = await prepareFromStorage(memo(friend(), 'n:2', '친구 메모'), makeEdit());
    // local의 publicId가 어긋나도 검증된 trip.publicId를 따른다.
    const skewed: PreparedImport = {
      ...prepared,
      local: { ...prepared.local, publicId: 'othertrip0001' },
    };

    const result = await commitImport(skewed, {}, NOW, { storage: storage(), locks: recording });

    expect(names).toEqual([KEY]);
    expect(result.ok).toBe(true);
    expect(storage().getItem(KEY)).not.toBeNull();
    expect(storage().getItem(storageKey('othertrip0001'))).toBeNull();
  });

  it('미리보기 후 다른 탭이 편집했으면 changed이고 쓰지 않는다; 다시 준비하면 둘 다 반영된다', async () => {
    const l0 = makeEdit();
    writeEditLayer(storage(), l0);
    const incoming = memo(friend(), 'n:2', '친구 메모', T2);

    const prepared = await prepareFromStorage(incoming, l0);

    // 다른 탭이 p1 메모를 추가했다.
    const l1 = memo(l0, 'n:1', 'p1 메모');
    writeEditLayer(storage(), l1);
    const l1Raw = storage().getItem(KEY);

    const first = await commitImport(prepared, {}, NOW, { storage: storage(), locks });
    expect(first).toEqual({ ok: false, reason: 'changed' });
    expect(storage().getItem(KEY)).toBe(l1Raw);

    const again = await prepareFromStorage(incoming, l0);
    const second = await commitImport(again, {}, NOW, { storage: storage(), locks });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.edit.places['n:1']?.memos['a-local']?.text).toBe('p1 메모');
    expect(second.edit.places['n:2']?.memos['a-friend']?.text).toBe('친구 메모');
    expect(storage().getItem(KEY)).toBe(JSON.stringify(second.edit));
  });

  it('처음 방문(snapshot null)인데 준비 후 다른 탭이 레이어를 만들었으면 changed', async () => {
    const draft = makeEdit();
    const prepared = await prepareFromStorage(memo(friend(), 'n:2', '친구 메모'), draft);
    expect(prepared.localSnapshot).toBeNull();

    const other = memo(makeEdit(), 'n:1', '다른 탭');
    writeEditLayer(storage(), other);
    const otherRaw = storage().getItem(KEY);

    const result = await commitImport(prepared, {}, NOW, { storage: storage(), locks });
    expect(result).toEqual({ ok: false, reason: 'changed' });
    expect(storage().getItem(KEY)).toBe(otherRaw);
  });

  it('처음 방문이고 그대로면 병합 결과를 저장한다 (locks 없음)', async () => {
    const prepared = await prepareFromStorage(memo(friend(), 'n:2', '친구 메모'), makeEdit());
    const result = await commitImport(prepared, {}, NOW, { storage: storage() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readEditLayer(storage(), PID, NOW_MS).edit).toEqual(result.edit);
    expect(result.edit.authors['a-friend']?.nickname).toBe('친구');
  });

  it('applyMerge가 실패하면 사유를 그대로 돌려주고 쓰지 않는다', async () => {
    const l0 = makeEdit();
    writeEditLayer(storage(), l0);
    const before = storage().getItem(KEY);
    // authors 합집합이 50명을 넘게 만든다.
    const authors: EditLayer['authors'] = {};
    for (let i = 0; i < LIMITS.authors; i += 1)
      authors[`a-${i}`] = { nickname: `n${i}`, updatedAt: T1 };
    const incoming = friend({ authorId: 'a-0', authors });

    const prepared = await prepareFromStorage(incoming, l0);
    const result = await commitImport(prepared, {}, NOW, { storage: storage(), locks });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).not.toBe('changed');
    expect(storage().getItem(KEY)).toBe(before);
  });

  it('다른 탭이 잠금을 쥔 동안 중단하면 AbortError로 끝나고, 잠금이 풀려도 쓰지 않는다', async () => {
    const l0 = makeEdit();
    writeEditLayer(storage(), l0);
    const before = storage().getItem(KEY);
    const prepared = await prepareFromStorage(memo(friend(), 'n:2', '친구 메모'), l0);
    const held = createHeldLocks();
    held.hold();
    const controller = new AbortController();

    const pending = commitImport(prepared, {}, NOW, {
      storage: storage(),
      locks: held.locks,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    held.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(storage().getItem(KEY)).toBe(before);
  });

  it('잠금을 얻은 시점에 이미 중단됐으면 쓰지 않는다 (signal을 무시하는 LockManager)', async () => {
    const l0 = makeEdit();
    writeEditLayer(storage(), l0);
    const before = storage().getItem(KEY);
    const prepared = await prepareFromStorage(memo(friend(), 'n:2', '친구 메모'), l0);
    const controller = new AbortController();
    // 요청 시점엔 중단 전이고, 잠금을 넘겨주기 직전에 중단된다(signal을 보지 않는 구현).
    const ignoring = {
      request: (name: string, ...rest: unknown[]) => {
        const cb = rest[rest.length - 1] as (lock: { name: string; mode: string }) => unknown;
        return Promise.resolve().then(() => {
          controller.abort();
          return cb({ name, mode: 'exclusive' });
        });
      },
    } as unknown as LockManager;

    await expect(
      commitImport(prepared, {}, NOW, {
        storage: storage(),
        locks: ignoring,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(storage().getItem(KEY)).toBe(before);
  });

  it('locks가 없어도 중단된 signal이면 쓰지 않는다', async () => {
    const l0 = makeEdit();
    writeEditLayer(storage(), l0);
    const before = storage().getItem(KEY);
    const prepared = await prepareFromStorage(memo(friend(), 'n:2', '친구 메모'), l0);
    const controller = new AbortController();
    controller.abort();
    await expect(
      commitImport(prepared, {}, NOW, { storage: storage(), signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(storage().getItem(KEY)).toBe(before);
  });

  it('병합 결과가 1MB를 넘으면 거부하고 쓰지 않는다', async () => {
    const l0 = withBulkyMemos(makeEdit(), 1001, 90);
    writeEditLayer(storage(), l0);
    const before = storage().getItem(KEY);
    const incoming = withBulkyMemos(friend(), 2001, 90);

    const prepared = await prepareFromStorage(incoming, l0);
    const result = await commitImport(prepared, {}, NOW, { storage: storage(), locks });
    expect(result).toEqual({ ok: false, reason: '병합 결과가 1MB를 넘어 저장할 수 없어요' });
    expect(storage().getItem(KEY)).toBe(before);
  });
});
