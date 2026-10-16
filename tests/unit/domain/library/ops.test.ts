import { describe, expect, it } from 'vitest';
import {
  addLabels,
  createAndAttachLabel,
  createLabel,
  deleteLabel,
  deletePlaces,
  mergeLabels,
  removeLabels,
  renameLabel,
  reorderLabels,
  restorePlaces,
  setLabelColor,
  setLabelIcon,
  setPlaceCategory,
  setPlaceMemo,
  setPlaceName,
  toggleLabel,
  type OpCtx,
  type OpResult,
} from 'src/domain/library/ops';
import { liveLabels } from 'src/domain/library/query';
import { safeParse } from 'src/schema/parse';
import {
  emptyLibrary,
  LABEL_COLORS,
  LibrarySchema,
  type FolderLink,
  type Label,
  type Library,
  type Place,
} from 'src/schema/library';

const T0 = '2026-10-08T01:00:00.000Z';
const NOW = '2026-10-08T02:00:00.000Z';
const f = <V>(value: V, updatedAt = T0) => ({ value, updatedAt });

let seq = 0;
const ctx: OpCtx = {
  now: NOW,
  newId: (kind) => {
    const n = String(seq++);
    return kind === 'place' ? `np${n.padStart(8, '0')}` : `nl${n.padStart(6, '0')}`;
  },
};

function place(id: string, over: Partial<Omit<Place, 'labelIds'>> & { labels?: string[] } = {}) {
  const { labels, ...rest } = over;
  return {
    id,
    source: { kind: 'naver' as const, sid: id.replace(/\D/g, '') || '1' },
    name: f(`장소 ${id}`),
    address: '강원특별자치도 강릉시 난설헌로 131',
    lng: 128.95,
    lat: 37.77,
    category: f<string | null>(null),
    labelIds: f<string[]>(labels ?? []),
    memo: f(''),
    saved: f(true),
    createdAt: T0,
    deletedAt: null,
    ...rest,
  } satisfies Place;
}

function label(id: string, name: string, order: number, over: Partial<Label> = {}): Label {
  return {
    id,
    name: f(name),
    color: f('red' as const),
    icon: f('star' as const),
    order: f(order),
    createdAt: T0,
    deletedAt: null,
    ...over,
  };
}

function lib(places: Place[], labels: Label[] = []): Library {
  return {
    ...emptyLibrary(),
    places: Object.fromEntries(places.map((p) => [p.id, p])),
    labels: Object.fromEntries(labels.map((l) => [l.id, l])),
  };
}

const valid = (l: Library) => safeParse(LibrarySchema, l).success;
const okLib = (r: OpResult): Library => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error._tag}`);
  return r.lib;
};

const P1 = 'place00001';
const P2 = 'place00002';
const P3 = 'place00003';
const A = 'labelaaa';
const B = 'labelbbb';
const C = 'labelccc';

describe('place field ops', () => {
  it('setPlaceMemo updates only memo field timestamp', () => {
    const before = lib([place(P1)]);
    const after = setPlaceMemo(before, P1, '조용한 곳', ctx);
    const p = after.places[P1]!;
    expect(p.memo).toEqual({ value: '조용한 곳', updatedAt: NOW });
    expect(p.name).toBe(before.places[P1]!.name);
    expect(p.category).toBe(before.places[P1]!.category);
    expect(p.labelIds).toBe(before.places[P1]!.labelIds);
    expect(p.saved).toBe(before.places[P1]!.saved);
    expect(before.places[P1]!.memo.value).toBe('');
    expect(valid(after)).toBe(true);
  });

  it('setPlaceMemo is a no-op when unchanged', () => {
    const before = lib([place(P1, { memo: f('그대로') })]);
    const after = setPlaceMemo(before, P1, '그대로', ctx);
    expect(after.places[P1]).toBe(before.places[P1]);
    expect(after).toBe(before);
    expect(valid(after)).toBe(true);
  });

  it('setPlaceName and setPlaceCategory change only their own field', () => {
    const before = lib([place(P1)]);
    const named = setPlaceName(before, P1, '새 이름', ctx);
    expect(named.places[P1]!.name).toEqual({ value: '새 이름', updatedAt: NOW });
    expect(named.places[P1]!.memo).toBe(before.places[P1]!.memo);
    const categorized = setPlaceCategory(named, P1, '카페', ctx);
    expect(categorized.places[P1]!.category).toEqual({ value: '카페', updatedAt: NOW });
    expect(categorized.places[P1]!.name).toBe(named.places[P1]!.name);
    const cleared = setPlaceCategory(categorized, P1, null, ctx);
    expect(cleared.places[P1]!.category.value).toBeNull();
    expect(valid(cleared)).toBe(true);
  });

  it('skips unknown place ids', () => {
    const before = lib([place(P1)]);
    expect(setPlaceMemo(before, 'nope000000', 'x', ctx)).toBe(before);
    expect(deletePlaces(before, ['nope000000'], ctx)).toBe(before);
  });

  it('deletePlaces then restorePlaces round-trips deletedAt', () => {
    const before = lib([place(P1), place(P2)]);
    const deleted = deletePlaces(before, [P1], ctx);
    expect(deleted.places[P1]!.deletedAt).toBe(NOW);
    expect(deleted.places[P2]).toBe(before.places[P2]);
    expect(valid(deleted)).toBe(true);

    const restored = restorePlaces(deleted, [P1], { ...ctx, now: '2026-10-08T03:00:00.000Z' });
    expect(restored.places[P1]!.deletedAt).toBeNull();
    expect(restored.places[P1]).toEqual(before.places[P1]);
    expect(valid(restored)).toBe(true);
  });

  it('deletePlaces keeps the first deletedAt and restore of a live place is a no-op', () => {
    const deleted = deletePlaces(lib([place(P1)]), [P1], ctx);
    const again = deletePlaces(deleted, [P1], { ...ctx, now: '2026-10-08T05:00:00.000Z' });
    expect(again).toBe(deleted);
    const live = lib([place(P2)]);
    expect(restorePlaces(live, [P2], ctx)).toBe(live);
  });
});

describe('place label ops', () => {
  const base = () =>
    lib([place(P1), place(P2), place(P3)], [label(A, '맛집', 0), label(B, '카페', 1)]);

  it('toggleLabel appends to end and removes', () => {
    const one = toggleLabel(base(), P1, A, ctx);
    expect(one.places[P1]!.labelIds).toEqual({ value: [A], updatedAt: NOW });
    const two = toggleLabel(one, P1, B, ctx);
    expect(two.places[P1]!.labelIds.value).toEqual([A, B]);
    const removed = toggleLabel(two, P1, A, ctx);
    expect(removed.places[P1]!.labelIds.value).toEqual([B]);
    expect(removed.places[P1]!.name).toBe(two.places[P1]!.name);
    expect(valid(removed)).toBe(true);
  });

  it('toggleLabel does not attach a deleted or unknown label', () => {
    const l = lib([place(P1)], [label(A, '맛집', 0, { deletedAt: T0 })]);
    expect(toggleLabel(l, P1, A, ctx)).toBe(l);
    expect(toggleLabel(l, P1, 'unknown00', ctx)).toBe(l);
  });

  it('toggleLabel on a place with duplicate ids removes all of them', () => {
    const l = lib([place(P1, { labels: [A, B, A] })], [label(A, '맛집', 0), label(B, '카페', 1)]);
    expect(toggleLabel(l, P1, A, ctx).places[P1]!.labelIds.value).toEqual([B]);
  });

  it('addLabels/removeLabels apply to many places', () => {
    const start = base();
    const added = addLabels(start, [P1, P2], [A, B], ctx);
    expect(added.places[P1]!.labelIds.value).toEqual([A, B]);
    expect(added.places[P2]!.labelIds.value).toEqual([A, B]);
    expect(added.places[P3]).toBe(start.places[P3]);
    expect(added.places[P3]!.labelIds.value).toEqual([]);
    expect(valid(added)).toBe(true);

    const removed = removeLabels(added, [P1, P2, P3], [A], ctx);
    expect(removed.places[P1]!.labelIds.value).toEqual([B]);
    expect(removed.places[P2]!.labelIds.value).toEqual([B]);
    expect(removed.places[P3]).toBe(added.places[P3]);
    expect(valid(removed)).toBe(true);
  });

  it('addLabels never duplicates and leaves already-labelled places untouched', () => {
    const first = addLabels(base(), [P1], [A, A], ctx);
    expect(first.places[P1]!.labelIds.value).toEqual([A]);
    const again = addLabels(first, [P1, P1], [A], { ...ctx, now: '2026-10-08T09:00:00.000Z' });
    expect(again).toBe(first);
  });

  it('addLabels skips deleted labels', () => {
    const l = lib([place(P1)], [label(A, '맛집', 0), label(B, '카페', 1, { deletedAt: T0 })]);
    const after = addLabels(l, [P1], [B, A], ctx);
    expect(after.places[P1]!.labelIds.value).toEqual([A]);
    expect(valid(after)).toBe(true);
  });

  it('removeLabels is a no-op when nothing is attached', () => {
    const l = base();
    expect(removeLabels(l, [P1], [A], ctx)).toBe(l);
  });
});

describe('label ops', () => {
  it('createLabel rejects taken name ignoring case/spaces', () => {
    const l = lib([], [label(A, 'Best Cafe', 0)]);
    for (const name of ['best cafe', '  BEST   cafe ']) {
      expect(createLabel(l, name, ctx)).toMatchObject({
        ok: false,
        error: { _tag: 'LabelNameTaken' },
      });
    }
  });

  it('createLabel ignores deleted labels when checking names', () => {
    const l = lib([], [label(A, '맛집', 0, { deletedAt: T0 })]);
    expect(createLabel(l, '맛집', ctx).ok).toBe(true);
  });

  it('createLabel rejects empty and over-long names, judged after trim', () => {
    const l = emptyLibrary();
    expect(createLabel(l, '', ctx)).toMatchObject({
      ok: false,
      error: { _tag: 'LabelNameInvalid' },
    });
    expect(createLabel(l, '   ', ctx)).toMatchObject({
      ok: false,
      error: { _tag: 'LabelNameInvalid' },
    });
    expect(createLabel(l, 'a'.repeat(31), ctx)).toMatchObject({
      ok: false,
      error: { _tag: 'LabelNameInvalid' },
    });
    const padded = createLabel(l, ` ${'a'.repeat(30)} `, ctx);
    expect(okLib(padded).labels[padded.ok ? padded.createdId! : '']!.name.value).toBe(
      'a'.repeat(30),
    );
  });

  it('createLabel stores a trimmed name, star icon, next order, and reports createdId', () => {
    const l = lib([], [label(A, '맛집', 4)]);
    const r = createLabel(l, '  새 라벨 ', ctx);
    expect(r.ok && r.createdId).toBeTruthy();
    const created = okLib(r).labels[(r as { createdId: string }).createdId]!;
    expect(created.name).toEqual({ value: '새 라벨', updatedAt: NOW });
    expect(created.icon).toEqual({ value: 'star', updatedAt: NOW });
    expect(created.order.value).toBe(5);
    expect(created.deletedAt).toBeNull();
    expect(l.labels[created.id]).toBeUndefined();
    expect(valid(okLib(r))).toBe(true);
  });

  it('createLabel starts order at 0 and picks palette color by live label count', () => {
    let l = emptyLibrary();
    const colors: string[] = [];
    const orders: number[] = [];
    for (let i = 0; i < 9; i++) {
      const r = createLabel(l, `라벨${i}`, ctx);
      l = okLib(r);
      const created = l.labels[(r as { createdId: string }).createdId]!;
      colors.push(created.color.value);
      orders.push(created.order.value);
    }
    expect(colors).toEqual([...LABEL_COLORS, LABEL_COLORS[0]]);
    expect(orders).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(valid(l)).toBe(true);
  });

  it('createLabel color counts only live labels', () => {
    const l = lib(
      [],
      [
        label(A, '하나', 0),
        label(B, '둘', 1, { deletedAt: T0 }),
        label(C, '셋', 2, { deletedAt: T0 }),
      ],
    );
    const r = createLabel(l, '넷', ctx);
    const created = okLib(r).labels[(r as { createdId: string }).createdId]!;
    expect(created.color.value).toBe(LABEL_COLORS[1]);
  });

  it('renameLabel trims, changes only name, and may recase itself', () => {
    const l = lib([], [label(A, 'cafe', 0), label(B, '맛집', 1)]);
    const r = okLib(renameLabel(l, A, '  Cafe ', ctx));
    expect(r.labels[A]!.name).toEqual({ value: 'Cafe', updatedAt: NOW });
    expect(r.labels[A]!.color).toBe(l.labels[A]!.color);
    expect(r.labels[B]).toBe(l.labels[B]);
    expect(valid(r)).toBe(true);
  });

  it('renameLabel is a no-op when unchanged', () => {
    const l = lib([], [label(A, '맛집', 0)]);
    expect(okLib(renameLabel(l, A, ' 맛집 ', ctx))).toBe(l);
  });

  it('renameLabel rejects taken, invalid and missing', () => {
    const l = lib(
      [],
      [label(A, '카페', 0), label(B, '맛집', 1), label(C, '지움', 2, { deletedAt: T0 })],
    );
    expect(renameLabel(l, A, ' 맛집', ctx)).toMatchObject({
      ok: false,
      error: { _tag: 'LabelNameTaken' },
    });
    expect(renameLabel(l, A, '', ctx)).toMatchObject({
      ok: false,
      error: { _tag: 'LabelNameInvalid' },
    });
    expect(renameLabel(l, 'nope0000', '아무거나', ctx)).toMatchObject({
      ok: false,
      error: { _tag: 'NotFound', id: 'nope0000' },
    });
    expect(renameLabel(l, C, '아무거나', ctx)).toMatchObject({
      ok: false,
      error: { _tag: 'NotFound' },
    });
  });

  it('setLabelColor and setLabelIcon change only their field', () => {
    const l = lib([], [label(A, '맛집', 0)]);
    const colored = setLabelColor(l, A, 'blue', ctx);
    expect(colored.labels[A]!.color).toEqual({ value: 'blue', updatedAt: NOW });
    expect(colored.labels[A]!.name).toBe(l.labels[A]!.name);
    const iconed = setLabelIcon(colored, A, 'coffee', ctx);
    expect(iconed.labels[A]!.icon).toEqual({ value: 'coffee', updatedAt: NOW });
    expect(iconed.labels[A]!.color).toBe(colored.labels[A]!.color);
    expect(setLabelColor(iconed, A, 'blue', ctx)).toBe(iconed);
    expect(setLabelIcon(iconed, 'nope0000', 'coffee', ctx)).toBe(iconed);
    expect(valid(iconed)).toBe(true);
  });

  it('reorderLabels renumbers live labels and keeps untouched ones identical', () => {
    const l = lib(
      [],
      [
        label(A, '가', 0),
        label(B, '나', 1),
        label(C, '다', 2),
        label('labelddd', '라', 9, { deletedAt: T0 }),
      ],
    );
    const r = reorderLabels(l, [C, A, 'unknown00'], ctx);
    expect(liveLabels(r).map((x) => x.id)).toEqual([C, A, B]);
    expect(r.labels[C]!.order).toEqual({ value: 0, updatedAt: NOW });
    expect(r.labels[A]!.order).toEqual({ value: 1, updatedAt: NOW });
    expect(r.labels[B]!.order).toEqual({ value: 2, updatedAt: NOW });
    expect(r.labels.labelddd).toBe(l.labels.labelddd);
    expect(valid(r)).toBe(true);
    expect(reorderLabels(r, [C, A, B], ctx)).toBe(r);
  });

  it('deleteLabel tombstones label and removes it from every place with new updatedAt; places stay', () => {
    const l = lib(
      [
        place(P1, { labels: [A, B] }),
        place(P2, { labels: [B] }),
        place(P3, { labels: [A], deletedAt: T0 }),
      ],
      [label(A, '맛집', 0), label(B, '카페', 1)],
    );
    const r = deleteLabel(l, A, ctx);
    expect(r.labels[A]!.deletedAt).toBe(NOW);
    expect(r.labels[B]).toBe(l.labels[B]);
    expect(r.places[P1]!.labelIds).toEqual({ value: [B], updatedAt: NOW });
    expect(r.places[P2]).toBe(l.places[P2]);
    expect(r.places[P3]!.labelIds).toEqual({ value: [], updatedAt: NOW });
    expect(r.places[P3]!.deletedAt).toBe(T0);
    expect(Object.keys(r.places)).toEqual(Object.keys(l.places));
    expect(l.labels[A]!.deletedAt).toBeNull();
    expect(valid(r)).toBe(true);
  });

  it('deleteLabel is a no-op for unknown or already deleted labels', () => {
    const l = lib([], [label(A, '맛집', 0, { deletedAt: T0 })]);
    expect(deleteLabel(l, A, ctx)).toBe(l);
    expect(deleteLabel(l, 'nope0000', ctx)).toBe(l);
  });

  it('mergeLabels attaches into-label once and deletes from-label', () => {
    const l = lib(
      [place(P1, { labels: [A, B] }), place(P2, { labels: [A] }), place(P3, { labels: [B] })],
      [label(A, '맛집', 0), label(B, '식당', 1), label(C, '카페', 2)],
    );
    const r = mergeLabels(l, A, B, ctx);
    expect(r.labels[A]!.deletedAt).toBe(NOW);
    expect(r.labels[B]).toBe(l.labels[B]);
    expect(r.places[P1]!.labelIds.value).toEqual([B]);
    expect(r.places[P2]!.labelIds.value).toEqual([B]);
    expect(r.places[P3]).toBe(l.places[P3]);
    expect(valid(r)).toBe(true);
  });

  it('mergeLabels puts into-label where from-label was and dedupes', () => {
    const l = lib(
      [place(P1, { labels: [A, C, B] })],
      [label(A, '가', 0), label(B, '나', 1), label(C, '다', 2)],
    );
    expect(mergeLabels(l, A, B, ctx).places[P1]!.labelIds.value).toEqual([B, C]);
    expect(mergeLabels(l, C, A, ctx).places[P1]!.labelIds.value).toEqual([A, B]);
  });

  it('mergeLabels ignores same, missing, or deleted labels', () => {
    const l = lib(
      [place(P1, { labels: [A] })],
      [label(A, '가', 0), label(B, '나', 1, { deletedAt: T0 })],
    );
    expect(mergeLabels(l, A, A, ctx)).toBe(l);
    expect(mergeLabels(l, A, B, ctx)).toBe(l);
    expect(mergeLabels(l, B, A, ctx)).toBe(l);
    expect(mergeLabels(l, A, 'nope0000', ctx)).toBe(l);
  });

  it('createAndAttachLabel creates and attaches a new label', () => {
    const l = lib([place(P1)], [label(A, '맛집', 0)]);
    const r = createAndAttachLabel(l, P1, ' 새 라벨 ', ctx);
    const next = okLib(r);
    const id = (r as { createdId: string }).createdId;
    expect(next.labels[id]!.name.value).toBe('새 라벨');
    expect(next.places[P1]!.labelIds.value).toEqual([id]);
    expect(valid(next)).toBe(true);
  });

  it('createAndAttachLabel reuses existing normalized label', () => {
    const l = lib([place(P1)], [label(A, 'Best Cafe', 0)]);
    const r = createAndAttachLabel(l, P1, '  best   CAFE ', ctx);
    const next = okLib(r);
    expect(r).not.toHaveProperty('createdId');
    expect(Object.keys(next.labels)).toEqual([A]);
    expect(next.labels[A]).toBe(l.labels[A]);
    expect(next.places[P1]!.labelIds.value).toEqual([A]);
    expect(valid(next)).toBe(true);
    // 이미 붙어 있으면 그대로
    expect(okLib(createAndAttachLabel(next, P1, 'best cafe', ctx))).toBe(next);
  });

  it('createAndAttachLabel rejects invalid names and unknown places', () => {
    const l = lib([place(P1)]);
    expect(createAndAttachLabel(l, P1, '  ', ctx)).toMatchObject({
      ok: false,
      error: { _tag: 'LabelNameInvalid' },
    });
    expect(createAndAttachLabel(l, 'nope000000', '맛집', ctx)).toMatchObject({
      ok: false,
      error: { _tag: 'NotFound', id: 'nope000000' },
    });
  });
});

describe('folder links follow label delete/merge', () => {
  const S1 = 'share1';
  const S2 = 'share2';
  const S3 = 'share3';
  const folderLink = (
    shareId: string,
    labelId: string,
    over: Partial<FolderLink> = {},
  ): FolderLink => ({
    shareId,
    name: f('폴더'),
    labelId: f(labelId),
    seenSids: f<string[]>(['1']),
    checkedAt: T0,
    createdAt: T0,
    deletedAt: null,
    ...over,
  });
  const withFolders = (l: Library, links: FolderLink[]): Library => ({
    ...l,
    folders: Object.fromEntries(links.map((x) => [x.shareId, x])),
  });
  const base = () =>
    withFolders(lib([place(P1, { labels: [A] })], [label(A, '맛집', 0), label(B, '카페', 1)]), [
      folderLink(S1, A),
      folderLink(S2, B),
      folderLink(S3, A, { deletedAt: T0 }),
    ]);

  it('deleteLabel unlinks only that label links', () => {
    const l = base();
    const r = deleteLabel(l, A, ctx);
    expect(r.folders![S1]!.deletedAt).toBe(NOW);
    expect(r.folders![S2]).toBe(l.folders![S2]);
    // 이미 지운 연결은 처음 지운 시각 그대로다.
    expect(r.folders![S3]).toBe(l.folders![S3]);
    expect(valid(r)).toBe(true);
  });

  it('mergeLabels moves links to the into-label', () => {
    const l = base();
    const r = mergeLabels(l, A, B, ctx);
    expect(r.folders![S1]!.labelId).toEqual({ value: B, updatedAt: NOW });
    expect(r.folders![S1]!.deletedAt).toBeNull();
    expect(r.folders![S2]).toBe(l.folders![S2]);
    expect(r.folders![S3]).toBe(l.folders![S3]);
    expect(valid(r)).toBe(true);
  });

  it('does not create a folders key on documents without one', () => {
    const l = lib([place(P1, { labels: [A] })], [label(A, '맛집', 0), label(B, '카페', 1)]);
    expect('folders' in deleteLabel(l, A, ctx)).toBe(false);
    expect('folders' in mergeLabels(l, A, B, ctx)).toBe(false);
  });
});
