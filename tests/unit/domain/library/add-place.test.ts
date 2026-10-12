import { describe, expect, it } from 'vitest';
import {
  addPlace,
  findExisting,
  importFolder,
  planFolderImport,
  sourceKey,
  type FolderItem,
  type PlaceCandidate,
} from 'src/domain/library/add-place';
import { TRUNCATION_MARK } from 'src/domain/library/legacy-import';
import type { OpCtx, OpResult } from 'src/domain/library/ops';
import { safeParse } from 'src/schema/parse';
import {
  emptyLibrary,
  LABEL_COLORS,
  LIBRARY_LIMITS,
  LibrarySchema,
  type Label,
  type Library,
  type Place,
  type PlaceSource,
} from 'src/schema/library';

const T0 = '2026-10-08T01:00:00.000Z';
const NOW = '2026-10-12T02:00:00.000Z';
const f = <V>(value: V, updatedAt = T0) => ({ value, updatedAt });

function makeCtx(): OpCtx {
  let seq = 0;
  return {
    now: NOW,
    newId: (kind) => {
      const n = String(seq++);
      return kind === 'place' ? `np${n.padStart(8, '0')}` : `nl${n.padStart(6, '0')}`;
    },
  };
}

function place(id: string, over: Partial<Place> = {}): Place {
  return {
    id,
    source: { kind: 'naver', sid: '100' },
    name: f(`장소 ${id}`),
    address: '강원특별자치도 강릉시 난설헌로 131',
    lng: 128.95,
    lat: 37.77,
    category: f<string | null>('카페'),
    labelIds: f<string[]>([]),
    memo: f(''),
    saved: f(true),
    createdAt: T0,
    deletedAt: null,
    ...over,
  };
}

function label(id: string, name: string, order: number, over: Partial<Label> = {}): Label {
  return {
    id,
    name: f(name),
    color: f<Label['color']['value']>('red'),
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
function ok(r: OpResult): Extract<OpResult, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got ${r.error._tag}`);
  return r;
}

const P1 = 'place00001';
const P2 = 'place00002';
const A = 'labelaaa';
const B = 'labelbbb';
const C = 'labelccc';

const naver = (sid: string): PlaceSource => ({ kind: 'naver', sid });

function candidate(over: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return {
    source: naver('100'),
    name: '새 이름',
    address: '새 주소',
    lng: 127.1,
    lat: 37.5,
    category: '한식',
    ...over,
  };
}

describe('sourceKey', () => {
  it('builds a key per source kind and none for a hand-placed pin', () => {
    expect(sourceKey(naver('11'))).toBe('naver:11');
    expect(sourceKey({ kind: 'kakao', kakaoId: '22' })).toBe('kakao:22');
    expect(sourceKey({ kind: 'google', googleId: '0x1:0x2' })).toBe('google:0x1:0x2');
    expect(sourceKey({ kind: 'pin', legacy: { publicId: 'abcdefghij', placeKey: 'c1' } })).toBe(
      'pin:abcdefghij/c1',
    );
    expect(sourceKey({ kind: 'pin' })).toBeNull();
  });

  it('does not confuse the same id across services', () => {
    expect(sourceKey(naver('22'))).not.toBe(sourceKey({ kind: 'kakao', kakaoId: '22' }));
  });
});

describe('findExisting', () => {
  it('prefers a live place over a deleted one with the same source', () => {
    const l = lib([place(P1, { deletedAt: T0 }), place(P2)]);
    expect(findExisting(l, naver('100'))?.id).toBe(P2);
  });

  it('falls back to a deleted place', () => {
    const l = lib([place(P1, { deletedAt: T0 })]);
    expect(findExisting(l, naver('100'))?.id).toBe(P1);
  });

  it('finds nothing for another sid or a hand-placed pin', () => {
    const l = lib([place(P1), place(P2, { source: { kind: 'pin' } })]);
    expect(findExisting(l, naver('999'))).toBeUndefined();
    expect(findExisting(l, { kind: 'pin' })).toBeUndefined();
  });
});

describe('addPlace', () => {
  it('creates a new place with the candidate values', () => {
    const before = lib([], [label(A, '카페', 0)]);
    const r = ok(addPlace(before, candidate(), { labelIds: [A], memo: '조용함' }, makeCtx()));
    expect(r.createdId).toBe('np00000000');
    expect(r.lib.places['np00000000']).toEqual({
      id: 'np00000000',
      source: naver('100'),
      name: { value: '새 이름', updatedAt: NOW },
      address: '새 주소',
      lng: 127.1,
      lat: 37.5,
      category: { value: '한식', updatedAt: NOW },
      labelIds: { value: [A], updatedAt: NOW },
      memo: { value: '조용함', updatedAt: NOW },
      saved: { value: true, updatedAt: NOW },
      createdAt: NOW,
      deletedAt: null,
    });
    expect(Object.keys(before.places)).toEqual([]);
    expect(valid(r.lib)).toBe(true);
  });

  it('truncates an over-long memo on a new place', () => {
    const r = ok(
      addPlace(lib([]), candidate(), { labelIds: [], memo: 'x'.repeat(10_050) }, makeCtx()),
    );
    const memo = r.lib.places[r.createdId!]!.memo.value;
    expect(memo.length).toBeLessThanOrEqual(LIBRARY_LIMITS.memoChars);
    expect(memo.endsWith(TRUNCATION_MARK)).toBe(true);
  });

  it('merges into a live place with the same sid: label union, memo appended, rest untouched', () => {
    const existing = place(P1, { labelIds: f([B, A]), memo: f('A') });
    const before = lib([existing], [label(A, '가', 0), label(B, '나', 1), label(C, '다', 2)]);
    const r = ok(addPlace(before, candidate(), { labelIds: [C, A], memo: 'B' }, makeCtx()));
    expect(r.createdId).toBe(P1);
    expect(Object.keys(r.lib.places)).toEqual([P1]);
    const p = r.lib.places[P1]!;
    expect(p.labelIds).toEqual({ value: [B, A, C], updatedAt: NOW });
    expect(p.memo).toEqual({ value: 'A\nB', updatedAt: NOW });
    expect(p.name).toBe(existing.name);
    expect(p.address).toBe(existing.address);
    expect(p.category).toBe(existing.category);
    expect(p.createdAt).toBe(T0);
    expect(valid(r.lib)).toBe(true);
  });

  it('does not append the same memo twice', () => {
    const existing = place(P1, { memo: f('A\nB') });
    const r = ok(addPlace(lib([existing]), candidate(), { labelIds: [], memo: 'B' }, makeCtx()));
    expect(r.lib.places[P1]!.memo).toBe(existing.memo);
  });

  it('keeps the same place object when nothing changes', () => {
    const existing = place(P1, { labelIds: f([A]), memo: f('A') });
    const before = lib([existing], [label(A, '가', 0)]);
    const r = ok(addPlace(before, candidate(), { labelIds: [A], memo: 'A' }, makeCtx()));
    expect(r.lib.places[P1]).toBe(existing);
  });

  it('uses the new memo as is when the existing memo is empty', () => {
    const r = ok(addPlace(lib([place(P1)]), candidate(), { labelIds: [], memo: 'B' }, makeCtx()));
    expect(r.lib.places[P1]!.memo.value).toBe('B');
  });

  it('leaves the memo field alone when the new memo is empty', () => {
    const existing = place(P1, { memo: f('A') });
    const r = ok(addPlace(lib([existing]), candidate(), { labelIds: [], memo: '  ' }, makeCtx()));
    expect(r.lib.places[P1]!.memo).toBe(existing.memo);
    expect(r.lib.places[P1]!.memo.updatedAt).toBe(T0);
  });

  it('restores a deleted place with the same sid and merges into it', () => {
    const existing = place(P1, { deletedAt: T0, labelIds: f([A]), memo: f('A') });
    const before = lib([existing], [label(A, '가', 0), label(B, '나', 1)]);
    const r = ok(addPlace(before, candidate(), { labelIds: [B], memo: 'B' }, makeCtx()));
    expect(r.createdId).toBe(P1);
    const p = r.lib.places[P1]!;
    expect(p.deletedAt).toBeNull();
    expect(p.labelIds.value).toEqual([A, B]);
    expect(p.memo.value).toBe('A\nB');
    expect(valid(r.lib)).toBe(true);
  });

  it('drops labels deleted since the place was deleted when restoring', () => {
    const existing = place(P1, { deletedAt: T0, labelIds: f([A, B]) });
    const before = lib([existing], [label(A, '가', 0, { deletedAt: T0 }), label(B, '나', 1)]);
    const r = ok(addPlace(before, candidate(), { labelIds: [], memo: '' }, makeCtx()));
    expect(r.lib.places[P1]!.labelIds.value).toEqual([B]);
    expect(valid(r.lib)).toBe(true);
  });

  it('marks a trip-only place as saved when it is added again', () => {
    const existing = place(P1, { saved: f(false) });
    const r = ok(addPlace(lib([existing]), candidate(), { labelIds: [], memo: '' }, makeCtx()));
    expect(r.lib.places[P1]!.saved).toEqual({ value: true, updatedAt: NOW });
  });

  it('truncates the combined memo to the limit with the truncation mark', () => {
    const existing = place(P1, { memo: f('a'.repeat(9_990)) });
    const r = ok(
      addPlace(lib([existing]), candidate(), { labelIds: [], memo: 'b'.repeat(50) }, makeCtx()),
    );
    const memo = r.lib.places[P1]!.memo.value;
    expect(memo.length).toBeLessThanOrEqual(LIBRARY_LIMITS.memoChars);
    expect(memo.endsWith(TRUNCATION_MARK)).toBe(true);
    expect(valid(r.lib)).toBe(true);
  });

  it('applies the same rules to kakao and google sources', () => {
    const kakao: PlaceSource = { kind: 'kakao', kakaoId: '777' };
    const google: PlaceSource = { kind: 'google', googleId: '0xabc:0xdef' };
    const before = lib(
      [place(P1, { source: kakao, memo: f('A') }), place(P2, { source: google, deletedAt: T0 })],
      [label(A, '가', 0)],
    );
    const k = ok(
      addPlace(before, candidate({ source: kakao }), { labelIds: [A], memo: 'B' }, makeCtx()),
    );
    expect(k.createdId).toBe(P1);
    expect(k.lib.places[P1]!.labelIds.value).toEqual([A]);
    expect(k.lib.places[P1]!.memo.value).toBe('A\nB');

    const g = ok(
      addPlace(before, candidate({ source: google }), { labelIds: [], memo: '' }, makeCtx()),
    );
    expect(g.createdId).toBe(P2);
    expect(g.lib.places[P2]!.deletedAt).toBeNull();

    // 서비스가 다르면 같은 번호여도 새 장소다.
    const n = ok(
      addPlace(before, candidate({ source: naver('777') }), { labelIds: [], memo: '' }, makeCtx()),
    );
    expect(n.createdId).toBe('np00000000');
  });

  it('always creates a new place for a hand-placed pin', () => {
    const pin: PlaceSource = { kind: 'pin' };
    const before = lib([place(P1, { source: pin })]);
    const r = ok(
      addPlace(
        before,
        candidate({ source: pin, category: null }),
        { labelIds: [], memo: '' },
        makeCtx(),
      ),
    );
    expect(r.createdId).toBe('np00000000');
    expect(Object.keys(r.lib.places)).toHaveLength(2);
    expect(r.lib.places['np00000000']!.category.value).toBeNull();
  });

  it('merges a legacy pin with the same legacy key', () => {
    const pin: PlaceSource = { kind: 'pin', legacy: { publicId: 'abcdefghij', placeKey: 'c1' } };
    const before = lib([place(P1, { source: pin })]);
    const r = ok(
      addPlace(before, candidate({ source: pin }), { labelIds: [], memo: '' }, makeCtx()),
    );
    expect(r.createdId).toBe(P1);
  });

  it('rejects an unknown or deleted label id', () => {
    const before = lib([], [label(A, '가', 0, { deletedAt: T0 })]);
    expect(addPlace(before, candidate(), { labelIds: ['labelzzz'], memo: '' }, makeCtx())).toEqual({
      ok: false,
      error: { _tag: 'NotFound', id: 'labelzzz' },
    });
    expect(addPlace(before, candidate(), { labelIds: [A], memo: '' }, makeCtx())).toEqual({
      ok: false,
      error: { _tag: 'NotFound', id: A },
    });
  });
});

function item(sid: string, over: Partial<FolderItem> = {}): FolderItem {
  return {
    sid,
    name: `폴더 장소 ${sid}`,
    address: '강원특별자치도 속초시',
    lng: 128.59,
    lat: 38.2,
    memo: '',
    ...over,
  };
}

describe('planFolderImport', () => {
  it('puts sids already in the library into merge and the rest into create', () => {
    const before = lib([place(P1, { source: naver('1') })]);
    const plan = planFolderImport(before, [item('1'), item('2')]);
    expect(plan.merge).toEqual([{ item: item('1'), placeId: P1 }]);
    expect(plan.create).toEqual([item('2')]);
  });

  it('treats a deleted place as new (it is restored, not shown as existing)', () => {
    const before = lib([place(P1, { source: naver('1'), deletedAt: T0 })]);
    const plan = planFolderImport(before, [item('1')]);
    expect(plan.merge).toEqual([]);
    expect(plan.create).toEqual([item('1')]);
  });

  it('keeps only the first item for a repeated sid', () => {
    const plan = planFolderImport(lib([]), [item('1'), item('1', { name: '중복' })]);
    expect(plan.create).toEqual([item('1')]);
  });
});

describe('importFolder', () => {
  const mixed = () =>
    lib(
      [
        place(P1, { source: naver('1'), labelIds: f([A]), memo: f('기존 메모') }),
        place(P2, { source: naver('2'), deletedAt: T0, labelIds: f([A]) }),
      ],
      [label(A, '가', 0)],
    );

  it('counts created, merged and restored places from the actual operation', () => {
    const before = mixed();
    const items = [item('1'), item('2'), item('3'), item('4')];
    const r = ok(importFolder(before, items, { newLabelName: '속초' }, makeCtx()));
    expect(r.summary).toEqual({ created: 2, merged: 1, restored: 1 });
    const labelId = r.createdId!;
    expect(r.lib.labels[labelId]!.name.value).toBe('속초');
    const live = Object.values(r.lib.places).filter((p) => p.deletedAt === null);
    expect(live).toHaveLength(4);
    for (const p of live) expect(p.labelIds.value).toContain(labelId);
    expect(r.lib.places[P2]!.deletedAt).toBeNull();
    expect(valid(r.lib)).toBe(true);
  });

  it('only adds the label to an existing place and leaves its memo alone', () => {
    const before = mixed();
    const r = ok(
      importFolder(before, [item('1', { memo: '폴더 메모' })], { labelId: A }, makeCtx()),
    );
    expect(r.createdId).toBe(A);
    expect(r.summary).toEqual({ created: 0, merged: 1, restored: 0 });
    const p = r.lib.places[P1]!;
    expect(p.memo).toBe(before.places[P1]!.memo);
    expect(p.name).toBe(before.places[P1]!.name);
    expect(p.labelIds.value).toEqual([A]);
  });

  it('keeps the memo of a restored place', () => {
    const before = lib([place(P2, { source: naver('2'), deletedAt: T0, memo: f('옛 메모') })]);
    const r = ok(
      importFolder(before, [item('2', { memo: '폴더 메모' })], { newLabelName: '새' }, makeCtx()),
    );
    expect(r.lib.places[P2]!.memo.value).toBe('옛 메모');
  });

  it('fills a new place from the folder item, truncating the folder memo', () => {
    const r = ok(
      importFolder(
        lib([]),
        [item('5', { memo: 'm'.repeat(10_100) })],
        { newLabelName: '새' },
        makeCtx(),
      ),
    );
    const p = Object.values(r.lib.places)[0]!;
    expect(p.source).toEqual(naver('5'));
    expect(p.name.value).toBe('폴더 장소 5');
    expect(p.address).toBe('강원특별자치도 속초시');
    expect(p.category.value).toBeNull();
    expect(p.saved.value).toBe(true);
    expect(p.memo.value.length).toBeLessThanOrEqual(LIBRARY_LIMITS.memoChars);
    expect(p.memo.value.endsWith(TRUNCATION_MARK)).toBe(true);
    expect(valid(r.lib)).toBe(true);
  });

  it('reuses a live label whose name differs only by case and spaces', () => {
    const before = lib([], [label(A, 'Sokcho  Food', 0)]);
    const r = ok(importFolder(before, [item('1')], { newLabelName: '  sokcho food ' }, makeCtx()));
    expect(r.createdId).toBe(A);
    expect(Object.keys(r.lib.labels)).toEqual([A]);
  });

  it('gives a new label the first color no live label uses', () => {
    const before = lib(
      [],
      [
        label(A, '가', 0, { color: f('red') }),
        label(B, '나', 1, { color: f('yellow') }),
        label(C, '다', 2, { color: f('orange'), deletedAt: T0 }),
      ],
    );
    const r = ok(importFolder(before, [item('1')], { newLabelName: '속초' }, makeCtx()));
    const created = r.lib.labels[r.createdId!]!;
    expect(created.color).toEqual({ value: 'orange', updatedAt: NOW });
    expect(created.order.value).toBe(2);
    expect(created.icon.value).toBe('star');
  });

  it('takes the color after the last label by order when every color is used', () => {
    const labels = LABEL_COLORS.map((color, i) =>
      label(`label00${i}`, `라벨 ${i}`, i === 2 ? 99 : i, { color: f(color) }),
    );
    const r = ok(importFolder(lib([], labels), [item('1')], { newLabelName: '속초' }, makeCtx()));
    // order가 가장 큰 라벨은 LABEL_COLORS[2]
    expect(r.lib.labels[r.createdId!]!.color.value).toBe(LABEL_COLORS[3]);
  });

  it('rejects a label name over 30 characters', () => {
    const name = '가'.repeat(31);
    expect(importFolder(lib([]), [item('1')], { newLabelName: name }, makeCtx())).toEqual({
      ok: false,
      error: { _tag: 'LabelNameInvalid', name },
    });
  });

  it('rejects an unknown or deleted label id', () => {
    const before = lib([], [label(A, '가', 0, { deletedAt: T0 })]);
    expect(importFolder(before, [item('1')], { labelId: A }, makeCtx())).toEqual({
      ok: false,
      error: { _tag: 'NotFound', id: A },
    });
  });

  it('imports a repeated sid once', () => {
    const r = ok(
      importFolder(lib([]), [item('1'), item('1')], { newLabelName: '속초' }, makeCtx()),
    );
    expect(r.summary).toEqual({ created: 1, merged: 0, restored: 0 });
    expect(Object.keys(r.lib.places)).toHaveLength(1);
  });
});
