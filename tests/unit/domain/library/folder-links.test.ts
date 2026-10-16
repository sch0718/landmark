import { describe, expect, it } from 'vitest';
import {
  folderLinks,
  folderLinksOfLabel,
  liveFolderLink,
  recordFolderLink,
  unlinkFolder,
  type FolderLinkInput,
} from 'src/domain/library/folder-links';
import type { OpCtx } from 'src/domain/library/ops';
import { safeParse } from 'src/schema/parse';
import {
  emptyLibrary,
  LibrarySchema,
  type FolderLink,
  type Label,
  type Library,
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
