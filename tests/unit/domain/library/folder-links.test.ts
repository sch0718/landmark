import { describe, expect, it } from 'vitest';
import {
  folderLinks,
  folderLinksOfLabel,
  liveFolderLink,
  planFolderSync,
  recordFolderLink,
  syncFolder,
  unlinkFolder,
  type FolderLinkInput,
} from 'src/domain/library/folder-links';
import type { FolderItem } from 'src/domain/library/add-place';
import type { OpCtx, OpResult } from 'src/domain/library/ops';
import { safeParse } from 'src/schema/parse';
import {
  emptyLibrary,
  LibrarySchema,
  type FolderLink,
  type Label,
  type Library,
  type Place,
} from 'src/schema/library';

const T0 = '2026-10-08T01:00:00.000Z';
const NOW = '2026-10-08T02:00:00.000Z';
const f = <V>(value: V, updatedAt = T0) => ({ value, updatedAt });
const ctx: OpCtx = { now: NOW, newId: () => 'unused000' };

const A = 'labelaaa';
const B = 'labelbbb';
const SHARE = 'fb65e7f93f8a4144a4ded594d604a7aa';
const SHARE2 = '0d5603c138bf4c498ba70ee59ba436e0';

function label(id: string, name: string, over: Partial<Label> = {}): Label {
  return {
    id,
    name: f(name),
    color: f('red' as const),
    icon: f('star' as const),
    order: f(0),
    createdAt: T0,
    deletedAt: null,
    ...over,
  };
}

function link(shareId: string, over: Partial<FolderLink> = {}): FolderLink {
  return {
    shareId,
    name: f('속초 맛집'),
    labelId: f(A),
    seenSids: f<string[]>(['1', '2']),
    checkedAt: T0,
    createdAt: T0,
    deletedAt: null,
    ...over,
  };
}

function lib(
  links: FolderLink[] | undefined,
  labels: Label[] = [label(A, '속초'), label(B, '강릉')],
) {
  const base: Library = {
    ...emptyLibrary(),
    labels: Object.fromEntries(labels.map((l) => [l.id, l])),
  };
  return links === undefined
    ? base
    : { ...base, folders: Object.fromEntries(links.map((l) => [l.shareId, l])) };
}

const valid = (l: Library) => safeParse(LibrarySchema, l).success;
const input = (over: Partial<FolderLinkInput> = {}): FolderLinkInput => ({
  shareId: SHARE,
  folderName: '속초 맛집',
  labelId: A,
  seenSids: ['1', '2'],
  ...over,
});

describe('recordFolderLink', () => {
  it('creates a new link with every timestamp = ctx.now', () => {
    const l = lib(undefined);
    const r = recordFolderLink(l, input(), ctx);
    expect(r.folders![SHARE]).toEqual({
      shareId: SHARE,
      name: { value: '속초 맛집', updatedAt: NOW },
      labelId: { value: A, updatedAt: NOW },
      seenSids: { value: ['1', '2'], updatedAt: NOW },
      checkedAt: NOW,
      createdAt: NOW,
      deletedAt: null,
    });
    expect(l.folders).toBeUndefined();
    expect(valid(r)).toBe(true);
  });

  it('keeps other links untouched', () => {
    const other = link(SHARE2);
    const r = recordFolderLink(lib([other]), input(), ctx);
    expect(r.folders![SHARE2]).toBe(other);
  });

  it('re-recording keeps createdAt, replaces values, and keeps updatedAt of unchanged fields', () => {
    const existing = link(SHARE, { createdAt: '2026-10-01T00:00:00.000Z' });
    const l = lib([existing]);
    const r = recordFolderLink(
      l,
      input({ labelId: B, folderName: '속초 맛집', seenSids: ['1', '2', '3'] }),
      ctx,
    );
    const next = r.folders![SHARE]!;
    expect(next.createdAt).toBe('2026-10-01T00:00:00.000Z');
    expect(next.checkedAt).toBe(NOW);
    expect(next.labelId).toEqual({ value: B, updatedAt: NOW });
    expect(next.seenSids).toEqual({ value: ['1', '2', '3'], updatedAt: NOW });
    // 이름은 같은 값이라 updatedAt이 그대로다.
    expect(next.name).toBe(existing.name);
    expect(valid(r)).toBe(true);
  });

  it('revives a deleted link with deletedAt null', () => {
    const l = lib([link(SHARE, { deletedAt: T0 })]);
    const r = recordFolderLink(l, input(), ctx);
    expect(r.folders![SHARE]!.deletedAt).toBeNull();
    expect(r.folders![SHARE]!.createdAt).toBe(T0);
    expect(valid(r)).toBe(true);
  });

  it('trims the name and cuts it to 100 chars', () => {
    const r = recordFolderLink(lib(undefined), input({ folderName: '  ' + '가'.repeat(120) }), ctx);
    expect(r.folders![SHARE]!.name.value).toBe('가'.repeat(100));
    expect(valid(r)).toBe(true);
  });

  it('dedupes seenSids in order and drops non-numeric ones', () => {
    const r = recordFolderLink(lib(undefined), input({ seenSids: ['1', '1', 'x', '2'] }), ctx);
    expect(r.folders![SHARE]!.seenSids.value).toEqual(['1', '2']);
  });

  it('keeps only the first 1,000 seenSids', () => {
    const sids = Array.from({ length: 1200 }, (_, i) => String(i + 1));
    const r = recordFolderLink(lib(undefined), input({ seenSids: sids }), ctx);
    expect(r.folders![SHARE]!.seenSids.value).toEqual(sids.slice(0, 1000));
    expect(valid(r)).toBe(true);
  });
});

describe('unlinkFolder', () => {
  it('stamps deletedAt on a live link', () => {
    const l = lib([link(SHARE)]);
    const r = unlinkFolder(l, SHARE, ctx);
    expect(r.folders![SHARE]).toEqual({ ...l.folders![SHARE], deletedAt: NOW });
    expect(valid(r)).toBe(true);
  });

  it('returns the same reference for unknown or already deleted links', () => {
    const l = lib([link(SHARE, { deletedAt: T0 })]);
    expect(unlinkFolder(l, SHARE, ctx)).toBe(l);
    expect(unlinkFolder(l, SHARE2, ctx)).toBe(l);
    const bare = lib(undefined);
    expect(unlinkFolder(bare, SHARE, ctx)).toBe(bare);
  });
});

describe('queries', () => {
  it('folderLinks falls back to an empty record', () => {
    expect(folderLinks(lib(undefined))).toEqual({});
    const l = lib([link(SHARE)]);
    expect(folderLinks(l)).toBe(l.folders);
  });

  it('liveFolderLink hides deleted links and links to deleted labels', () => {
    const live = link(SHARE);
    const gone = link(SHARE2, { deletedAt: T0 });
    const l = lib([live, gone]);
    expect(liveFolderLink(l, SHARE)).toBe(live);
    expect(liveFolderLink(l, SHARE2)).toBeUndefined();
    expect(liveFolderLink(l, 'unknown')).toBeUndefined();

    const orphan = lib([link(SHARE)], [label(A, '속초', { deletedAt: T0 })]);
    expect(liveFolderLink(orphan, SHARE)).toBeUndefined();
    expect(liveFolderLink(lib(undefined), SHARE)).toBeUndefined();
  });

  it('folderLinksOfLabel lists live links of the label sorted by name (ko)', () => {
    const l = lib([
      link('s1', { name: f('하나') }),
      link('s2', { name: f('가나') }),
      link('s3', { name: f('다라'), labelId: f(B) }),
      link('s4', { name: f('나나'), deletedAt: T0 }),
    ]);
    expect(folderLinksOfLabel(l, A).map((x) => x.shareId)).toEqual(['s2', 's1']);
    expect(folderLinksOfLabel(l, B).map((x) => x.shareId)).toEqual(['s3']);
    expect(folderLinksOfLabel(lib(undefined), A)).toEqual([]);
  });
});

// ---------- 다시 가져오기 ----------

let seq = 0;
const syncCtx = (): OpCtx => ({ now: NOW, newId: () => `np${String(seq++).padStart(8, '0')}` });

function place(id: string, sid: string, over: Partial<Place> = {}): Place {
  return {
    id,
    source: { kind: 'naver', sid },
    name: f(`보관함 ${sid}`),
    address: '강원특별자치도 속초시',
    lng: 128.59,
    lat: 38.2,
    category: f<string | null>(null),
    labelIds: f<string[]>([]),
    memo: f(''),
    saved: f(true),
    createdAt: T0,
    deletedAt: null,
    ...over,
  };
}

const item = (sid: string, over: Partial<FolderItem> = {}): FolderItem => ({
  sid,
  name: `폴더 ${sid}`,
  address: '강원특별자치도 고성군',
  lng: 128.5,
  lat: 38.3,
  memo: `네이버 메모 ${sid}`,
  ...over,
});

function ok(r: OpResult): Extract<OpResult, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got ${r.error._tag}`);
  return r;
}

/** 본 장소 1~4, 보관함: 1 살아 있음(라벨 없음), 2 지움, 3 살아 있음, 6 살아 있음(다른 라벨), 7 지움, 4 없음. */
function syncLib(links: FolderLink[] = [link(SHARE, { seenSids: f(['1', '2', '3', '4']) })]) {
  return {
    ...lib(links),
    places: {
      place00001: place('place00001', '1'),
      place00002: place('place00002', '2', { deletedAt: T0, labelIds: f([A]) }),
      place00003: place('place00003', '3', { name: f('세 번째 집'), address: '속초시 중앙로' }),
      place00006: place('place00006', '6', { labelIds: f([B]) }),
      place00007: place('place00007', '7', { deletedAt: T0 }),
    },
  };
}
const FOLDER = [item('1'), item('2'), item('5'), item('6'), item('7'), item('5', { name: '중복' })];

describe('planFolderSync', () => {
  it('splits the folder into fresh, deleted, unchanged and missing', () => {
    const l = syncLib();
    const plan = planFolderSync(l, l.folders![SHARE]!, FOLDER);
    expect(plan.fresh.map((x) => [x.item.sid, x.mark])).toEqual([
      ['5', null],
      ['6', 'in-library'],
      ['7', 'deleted'],
    ]);
    expect(plan.fresh[0]!.item.name).toBe('폴더 5');
    expect(plan.deleted.map((i) => i.sid)).toEqual(['2']);
    expect(plan.unchanged).toBe(1);
    expect(plan.missing).toEqual([
      { sid: '3', placeId: 'place00003', name: '세 번째 집', address: '속초시 중앙로' },
    ]);
  });

  it('treats everything as fresh when nothing was seen, and nothing is missing', () => {
    const l = syncLib([link(SHARE, { seenSids: f<string[]>([]) })]);
    const plan = planFolderSync(l, l.folders![SHARE]!, [item('1'), item('9')]);
    expect(plan.fresh.map((x) => [x.item.sid, x.mark])).toEqual([
      ['1', 'in-library'],
      ['9', null],
    ]);
    expect(plan).toMatchObject({ deleted: [], unchanged: 0, missing: [] });
  });

  it('lists missing places in seenSids order and skips ones deleted from the library', () => {
    const l = syncLib([link(SHARE, { seenSids: f(['3', '2', '1', '4']) })]);
    const plan = planFolderSync(l, l.folders![SHARE]!, []);
    expect(plan.missing.map((m) => m.sid)).toEqual(['3', '1']);
    expect(plan).toMatchObject({ fresh: [], deleted: [], unchanged: 0 });
  });

  it('does not change its inputs', () => {
    const l = syncLib();
    const before = structuredClone(l);
    planFolderSync(l, l.folders![SHARE]!, FOLDER);
    expect(l).toEqual(before);
  });
});

describe('syncFolder', () => {
  const run = (l: Library, pickedSids: string[], items = FOLDER, folderName = '속초 맛집') =>
    syncFolder(l, { shareId: SHARE, folderName, items, pickedSids }, syncCtx());

  it('imports only the picked places into the linked label and records what was seen', () => {
    const before = syncLib();
    const r = ok(run(before, ['5', '2']));
    expect(r.summary).toEqual({ created: 1, merged: 0, restored: 1 });
    expect(r.createdId).toBe(A);
    const live = Object.values(r.lib.places).filter((p) => p.deletedAt === null);
    const created = live.find((p) => p.source.kind === 'naver' && p.source.sid === '5')!;
    expect(created.labelIds.value).toEqual([A]);
    expect(created.memo.value).toBe('네이버 메모 5');
    expect(r.lib.places.place00002!.deletedAt).toBeNull();
    expect(r.lib.places.place00002!.labelIds.value).toEqual([A]);
    // 고르지 않은 곳은 그대로다: 뗐던 라벨을 다시 붙이지 않는다.
    expect(r.lib.places.place00001).toBe(before.places.place00001);
    expect(r.lib.places.place00006).toBe(before.places.place00006);
    expect(r.lib.places.place00007).toBe(before.places.place00007);
    expect(live.map((p) => p.id)).not.toContain('place00007');
    const next = r.lib.folders![SHARE]!;
    expect(next.seenSids.value).toEqual(['1', '2', '5', '6', '7']);
    expect(next.checkedAt).toBe(NOW);
    expect(valid(r.lib)).toBe(true);
  });

  it('with nothing picked only updates seenSids and checkedAt', () => {
    const before = syncLib();
    const r = ok(run(before, []));
    expect(r.summary).toEqual({ created: 0, merged: 0, restored: 0 });
    expect(r.lib.places).toEqual(before.places);
    const next = r.lib.folders![SHARE]!;
    expect(next.seenSids.value).toEqual(['1', '2', '5', '6', '7']);
    expect(next.checkedAt).toBe(NOW);
    expect(next.createdAt).toBe(T0);
    expect(valid(r.lib)).toBe(true);
  });

  it('uses the link own label, ignoring picked sids that are not in the folder', () => {
    const r = ok(run(syncLib(), ['6', 'zzz']));
    expect(r.summary).toEqual({ created: 0, merged: 1, restored: 0 });
    expect(r.lib.places.place00006!.labelIds.value).toEqual([B, A]);
  });

  it('fails with NotFound for a missing, deleted or orphaned link', () => {
    const cases: Library[] = [
      lib(undefined),
      syncLib([link(SHARE, { deletedAt: T0 })]),
      { ...syncLib(), labels: { [A]: label(A, '속초', { deletedAt: T0 }) } },
    ];
    for (const l of cases) {
      const r = run(l, ['5']);
      expect(r).toEqual({ ok: false, error: { _tag: 'NotFound', id: SHARE } });
    }
  });

  it('stays valid for a folder with a repeated sid and a 101-char name', () => {
    const long = '가'.repeat(101);
    const r = ok(run(syncLib(), ['5'], [item('5'), item('5', { name: '중복' })], long));
    expect(
      Object.values(r.lib.places).filter((p) => p.source.kind === 'naver' && p.source.sid === '5'),
    ).toHaveLength(1);
    expect(r.lib.folders![SHARE]!.name.value).toBe('가'.repeat(100));
    expect(r.lib.folders![SHARE]!.seenSids.value).toEqual(['5']);
    expect(valid(r.lib)).toBe(true);
  });
});
