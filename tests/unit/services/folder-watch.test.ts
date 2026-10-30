import { beforeEach, expect, it, vi } from 'vitest';
import {
  runFolderWatch,
  folderSignature,
  changeMessage,
  startFolderWatch,
} from 'src/services/folder-watch/folder-watch';
import type { FolderWatchDeps } from 'src/services/folder-watch/folder-watch';
import {
  readFolderWatch,
  writeFolderWatch,
  EMPTY_FOLDER_WATCH,
} from 'src/services/folder-watch/state';
import { recordFolderLink } from 'src/domain/library/folder-links';
import { makeLibrary, label, place } from '../domain/backup/fixtures';
import { readFileSync } from 'node:fs';
import type { FolderResult } from 'src/server/resolve';
const fixture: FolderResult = JSON.parse(
  readFileSync('tests/fixtures/links/api/naver-folder.json', 'utf8'),
);
import { Layer, ManagedRuntime } from 'effect';
import { PlaceLookup } from 'src/services/place-lookup';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { getDefaultStore } from 'jotai';
import { libraryAtom } from 'src/stores/library-state';
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const now = Date.parse('2026-10-30T00:00:00Z');
const id = 'a'.repeat(32);
function setup() {
  let time = now;
  let lib = recordFolderLink(
    makeLibrary({
      labels: [label(1)],
      places: fixture.places.map((p, i) => place(i + 1, { source: { kind: 'naver', sid: p.sid } })),
    }),
    {
      shareId: id,
      folderName: fixture.folderName,
      labelId: label(1).id,
      seenSids: fixture.places.map((p) => p.sid),
    },
    { now: new Date(now - 3 * 86400000).toISOString(), newId: () => '' },
  );
  const lookup = vi.fn().mockResolvedValue({
    ok: true,
    items: [...fixture.places, { ...fixture.places[0], sid: '999' }],
  });
  const deps: FolderWatchDeps = {
    storage: localStorage,
    library: () => lib,
    lookup,
    now: () => time,
  };
  return {
    deps,
    lookup,
    advance: () => {
      time += 86400000;
    },
    unlink: () => {
      lib = { ...lib, folders: {} };
    },
  };
}
beforeEach(() => {
  localStorage.clear();
  toast.mockClear();
});
it('같은 변화는 한 번만 알리고 새 변화는 다시 알린다', async () => {
  const h = setup();
  expect((await runFolderWatch(h.deps)).changes[0]?.fresh).toBe(1);
  expect(readFolderWatch(localStorage).folders[id]?.notified).toBeTruthy();
  h.advance();
  expect((await runFolderWatch(h.deps)).changes).toEqual([]);
  h.advance();
  h.lookup.mockResolvedValue({
    ok: true,
    items: [
      ...fixture.places,
      { ...fixture.places[0], sid: '999' },
      { ...fixture.places[0], sid: '998' },
    ],
  });
  expect((await runFolderWatch(h.deps)).changes[0]?.fresh).toBe(2);
  expect(folderSignature(['2', '1'], ['4', '3'])).toBe(folderSignature(['1', '2'], ['3', '4']));
});
it('빠진 곳만 있어도 알린다', async () => {
  const h = setup();
  h.lookup.mockResolvedValue({ ok: true, items: fixture.places.slice(1) });
  expect((await runFolderWatch(h.deps)).changes[0]).toMatchObject({ fresh: 0, missing: 1 });
});
it('찾지 못함과 다른 오류를 다르게 기록한다', async () => {
  const h = setup();
  await runFolderWatch(h.deps);
  const prev = readFolderWatch(localStorage).folders[id];
  h.advance();
  h.lookup.mockResolvedValue({ ok: false, code: 'OFFLINE' });
  await runFolderWatch(h.deps);
  expect(readFolderWatch(localStorage).folders[id]).toMatchObject({
    ...prev,
    checkedAt: now + 86400000,
  });
  h.advance();
  h.lookup.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
  expect((await runFolderWatch(h.deps)).changes).toEqual([]);
  expect(readFolderWatch(localStorage).folders[id]?.error).toBe('not-found');
});
it('꺼짐·수동 간격·잠금과 끊긴 연결을 지킨다', async () => {
  const h = setup();
  writeFolderWatch(localStorage, { ...EMPTY_FOLDER_WATCH, enabled: false });
  expect((await runFolderWatch(h.deps)).skipped).toBe('disabled');
  expect(h.lookup).not.toHaveBeenCalled();
  expect((await runFolderWatch(h.deps, { manual: true })).checked).toBe(1);
  expect((await runFolderWatch(h.deps, { manual: true })).skipped).toBe('gap');
  h.advance();
  h.deps.locks = { request: vi.fn((_name, _opts, fn) => fn(null)) } as unknown as Pick<
    LockManager,
    'request'
  >;
  expect((await runFolderWatch(h.deps, { manual: true })).skipped).toBe('busy');
  h.deps.locks = undefined;
  h.lookup.mockImplementation(async () => {
    h.unlink();
    return { ok: true, items: [] };
  });
  expect((await runFolderWatch(h.deps, { manual: true })).changes).toEqual([]);
  expect(readFolderWatch(localStorage).folders).toEqual({});
});
it('토스트 문구 네 모양을 만든다', () => {
  const change = { shareId: id, name: '폴더', fresh: 2, missing: 0 };
  expect(changeMessage([change])).toBe('‘폴더’ 폴더에 새로 저장한 곳이 2곳 있어요');
  expect(changeMessage([{ ...change, missing: 1 }])).toContain(' · 빠진 곳 1곳');
  expect(changeMessage([{ ...change, fresh: 0, missing: 1 }])).toBe(
    '‘폴더’ 폴더에서 빠진 곳이 1곳 있어요',
  );
  expect(changeMessage([change, change])).toBe('네이버 폴더 2개가 바뀌었어요 (새로 저장한 곳 4곳)');
});
it('실제 조회 서비스에는 fresh 옵션을 붙이지 않는다', async () => {
  const h = setup();
  getDefaultStore().set(libraryAtom, h.deps.library());
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => new Response(JSON.stringify(fixture)));
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(PlaceLookup.layerWith({ fetch }), Layer.empty),
  );
  setAppRuntimeForTest(runtime as Parameters<typeof setAppRuntimeForTest>[0]);
  try {
    await startFolderWatch({ navigate: () => {}, manual: true });
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]?.[0])).not.toContain('fresh');
  } finally {
    setAppRuntimeForTest(null);
    await runtime.dispose();
  }
});
it('진행 중 알림을 끄면 다시 켜거나 다음 폴더를 조회하지 않는다', async () => {
  const h = setup();
  const first = h.deps.library();
  h.deps.library = () => ({
    ...first,
    folders: { ...first.folders, second: { ...first.folders![id]!, shareId: 'second' } },
  });
  h.lookup.mockImplementation(async () => {
    writeFolderWatch(localStorage, { ...readFolderWatch(localStorage), enabled: false });
    return { ok: true, items: [...fixture.places, { ...fixture.places[0], sid: '999' }] };
  });
  const result = await runFolderWatch(h.deps);
  expect(readFolderWatch(localStorage).enabled).toBe(false);
  expect(h.lookup).toHaveBeenCalledOnce();
  expect(result.changes).toEqual([]);
});

it('모두 실패한 수동 확인은 성공 시각과 수동 간격을 올리지 않아 바로 다시 시도할 수 있다', async () => {
  const h = setup();
  await runFolderWatch(h.deps, { manual: true });
  h.advance();
  h.lookup.mockResolvedValue({ ok: false, code: 'OFFLINE' });
  const before = readFolderWatch(localStorage);
  expect(await runFolderWatch(h.deps, { manual: true })).toMatchObject({ checked: 1, failed: 1 });
  const after = readFolderWatch(localStorage);
  expect(after.lastManualAt).toBe(before.lastManualAt);
  expect(after.lastRunAt).toBe(before.lastRunAt);
  expect(after.folders[id]).toMatchObject({ checkedAt: now + 86400000, okAt: now });
  expect((await runFolderWatch(h.deps, { manual: true })).skipped).toBeUndefined();
});
it('첫 확인이 실패하면 성공 시각은 없다', async () => {
  const h = setup();
  h.lookup.mockRejectedValue(Error('연결 끊김'));
  await runFolderWatch(h.deps, { manual: true });
  expect(readFolderWatch(localStorage).folders[id]).toMatchObject({ checkedAt: now, okAt: null });
  expect(readFolderWatch(localStorage).lastRunAt).toBeNull();
});
it.each(['all', 'partial', 'changed', 'not-found'] as const)(
  '수동 확인 %s 결과를 사실대로 알린다',
  async (mode) => {
    const h = setup();
    const first = h.deps.library();
    getDefaultStore().set(libraryAtom, {
      ...first,
      folders: { ...first.folders, second: { ...first.folders![id]!, shareId: 'second' } },
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => new Response('{}', { status: 503 }));
    if (mode !== 'all')
      fetch.mockImplementationOnce(
        async () =>
          new Response(
            JSON.stringify(
              mode === 'not-found'
                ? { error: { code: 'NOT_FOUND' } }
                : {
                    ...fixture,
                    places:
                      mode === 'changed'
                        ? [...fixture.places, { ...fixture.places[0], sid: '999' }]
                        : fixture.places,
                  },
            ),
            { status: mode === 'not-found' ? 404 : 200 },
          ),
      );
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(PlaceLookup.layerWith({ fetch }), Layer.empty),
    );
    setAppRuntimeForTest(runtime as Parameters<typeof setAppRuntimeForTest>[0]);
    try {
      const result = await startFolderWatch({ navigate: () => {}, manual: true });
      expect(result.failed).toBe(mode === 'all' ? 2 : 1);
      if (mode === 'all')
        expect(toast).toHaveBeenCalledWith(
          '네이버 폴더를 확인하지 못했어요. 잠시 뒤 다시 해 주세요',
        );
      else if (mode === 'changed')
        expect(toast).toHaveBeenCalledWith(
          expect.stringContaining('새로 저장한 곳이 1곳'),
          expect.anything(),
        );
      else expect(toast).toHaveBeenCalledWith('바뀐 네이버 폴더가 없어요 (확인하지 못한 폴더 1개)');
    } finally {
      setAppRuntimeForTest(null);
      await runtime.dispose();
    }
  },
);
