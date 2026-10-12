import { describe, expect, it } from 'vitest';
import {
  applyImportPlan,
  combineMemos,
  legacyLabelSources,
  planLegacyImport,
  semanticKey,
  truncateMemo,
  TRUNCATION_MARK,
  type ImportChoices,
  type ImportPlan,
  type LegacySource,
  type PlannedIds,
} from 'src/domain/library/legacy-import';
import { liveLabels } from 'src/domain/library/query';
import { emptyLibrary, LibrarySchema, type Library, type Place } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import type { TripData } from 'src/schema/legacy/trip-data';
import { makeEdit, makeTrip } from '../../../fixtures/builders';
import type { IdKind } from 'src/services/id-gen';

const T0 = '2026-10-01T00:00:00.000Z';
const NOW = '2026-10-09T00:00:00.000Z';
const NO_CHOICES: ImportChoices = { labels: {}, memos: {} };
const f = <V>(value: V, updatedAt = T0) => ({ value, updatedAt });

let seq = 0;
const newId = (kind: IdKind): string => {
  const n = String(seq++);
  if (kind !== 'place' && kind !== 'label') throw new Error(`테스트에서 쓰지 않는 종류: ${kind}`);
  return kind === 'place' ? `np${n.padStart(8, '0')}` : `nl${n.padStart(6, '0')}`;
};

const plan = (
  lib: Library,
  src: LegacySource,
  choices: ImportChoices = NO_CHOICES,
  ids: PlannedIds | null = null,
): ImportPlan => planLegacyImport(lib, src, choices, ids, newId, NOW);

const apply = (lib: Library, src: LegacySource, choices: ImportChoices = NO_CHOICES): Library =>
  applyImportPlan(lib, plan(lib, src, choices));

const livePlaceList = (lib: Library): Place[] =>
  Object.values(lib.places).filter((p) => p.deletedAt === null);

const trip2 = (): TripData => makeTrip({ days: {}, places: ['A', 'B'] });
const src = (trip: TripData = trip2(), edit: LegacySource['edit'] = null): LegacySource => ({
  trip,
  edit,
});

function libPlace(id: string, over: Partial<Place> = {}): Place {
  return {
    id,
    source: { kind: 'naver', sid: '1' },
    name: f('기존 이름'),
    address: '기존 주소',
    lng: 127,
    lat: 37,
    category: f('기존 분류'),
    labelIds: f([]),
    memo: f('기존 메모'),
    saved: f(true),
    createdAt: T0,
    deletedAt: null,
    ...over,
  };
}

function libLabel(id: string, name: string, order = 0) {
  return {
    id,
    name: f(name),
    color: f('red' as const),
    icon: f('star' as const),
    order: f(order),
    createdAt: T0,
    deletedAt: null,
  };
}

function libWith(places: Place[], labels: ReturnType<typeof libLabel>[] = []): Library {
  return {
    ...emptyLibrary(),
    places: Object.fromEntries(places.map((p) => [p.id, p])),
    labels: Object.fromEntries(labels.map((l) => [l.id, l])),
  };
}

const labelNamesOf = (lib: Library, place: Place): string[] =>
  place.labelIds.value.map((id) => lib.labels[id]!.name.value);

describe('planLegacyImport / applyImportPlan', () => {
  it('naver place becomes naver source; custom place becomes pin with legacy ref', () => {
    const trip = trip2();
    trip.places['c:pin1'] = {
      name: '사용자 지정',
      address: '주소 C',
      lng: 128,
      lat: 38,
      category: null,
      folderIds: [],
      savedAt: null,
    };
    const lib = apply(emptyLibrary(), src(trip));
    const list = livePlaceList(lib);
    expect(list).toHaveLength(3);
    const a = list.find((p) => p.name.value === 'A')!;
    expect(a.source).toEqual({ kind: 'naver', sid: '1' });
    const pin = list.find((p) => p.name.value === '사용자 지정')!;
    expect(pin.source).toEqual({
      kind: 'pin',
      legacy: { publicId: 'testtrip0001', placeKey: 'c:pin1' },
    });
    expect(pin.address).toBe('주소 C');
    expect(pin.lng).toBe(128);
    expect(pin.category.value).toBeNull();
  });

  it('existing naver sid merges labels only, keeps name/category/memo', () => {
    const existing = libPlace('exist00001', { source: { kind: 'naver', sid: '1' } });
    const lib = libWith([existing]);
    const result = apply(lib, src(makeTrip({ days: {}, places: ['A'] })));
    const list = livePlaceList(result);
    expect(list).toHaveLength(1);
    const merged = list[0]!;
    expect(merged.id).toBe('exist00001');
    expect(merged.name).toEqual(existing.name);
    expect(merged.category).toEqual(existing.category);
    expect(merged.memo).toEqual(existing.memo);
    expect(labelNamesOf(result, merged)).toEqual(['테스트 폴더']);
  });

  it('existing legacy pin merges labels only', () => {
    const trip = makeTrip({ days: {} });
    trip.places['c:pin1'] = {
      name: '핀',
      address: '',
      lng: 128,
      lat: 38,
      category: null,
      folderIds: ['f1'],
      savedAt: null,
    };
    const existing = libPlace('pinexist01', {
      source: { kind: 'pin', legacy: { publicId: 'testtrip0001', placeKey: 'c:pin1' } },
      name: f('내가 바꾼 이름'),
    });
    const result = apply(libWith([existing]), src(trip));
    expect(livePlaceList(result)).toHaveLength(1);
    const merged = result.places['pinexist01']!;
    expect(merged.name.value).toBe('내가 바꾼 이름');
    expect(labelNamesOf(result, merged)).toEqual(['테스트 폴더']);
  });

  it('reimporting same file twice creates no duplicates', () => {
    const trip = trip2();
    trip.places['c:pin1'] = {
      name: '핀',
      address: '',
      lng: 128,
      lat: 38,
      category: null,
      folderIds: ['f1'],
      savedAt: null,
    };
    const source = src(trip);
    const once = apply(emptyLibrary(), source);
    const second = plan(once, source);
    expect(second.summary.added).toBe(0);
    expect(second.summary.existing).toBe(3);
    const twice = applyImportPlan(once, second);
    expect(livePlaceList(twice)).toHaveLength(3);
    expect(Object.keys(twice.labels)).toHaveLength(1);
    expect(safeParse(LibrarySchema, twice).success).toBe(true);
  });

  it('folder name and tag become labels; reuses existing label by normalized name', () => {
    const edit = makeEdit({
      places: {
        'n:1': {
          memos: {},
          tags: { value: ['  Cafe  Time ', '맛집'], updatedAt: T0 },
        },
      },
    });
    const lib = libWith([], [libLabel('lab00001', '  cafe time')]);
    const p = plan(lib, src(makeTrip({ days: {}, places: ['A'] }), edit));
    expect(p.summary.newLabels).toBe(2);
    expect(p.labels.map((l) => [l.normalizedName, l.action])).toEqual([
      ['테스트 폴더', 'create'],
      ['cafe time', 'reuse'],
      ['맛집', 'create'],
    ]);
    expect(p.labels.find((l) => l.action === 'reuse')!.labelId).toBe('lab00001');
    const result = applyImportPlan(lib, p);
    expect(liveLabels(result).map((l) => l.name.value)).toEqual([
      '  cafe time',
      '테스트 폴더',
      '맛집',
    ]);
    const only = livePlaceList(result)[0]!;
    expect(labelNamesOf(result, only).sort()).toEqual(
      ['  cafe time', '맛집', '테스트 폴더'].sort(),
    );
    expect(safeParse(LibrarySchema, result).success).toBe(true);
  });

  it('new labels follow the palette, default icon, and next order', () => {
    const lib = libWith([], [libLabel('lab00001', '기존', 4)]);
    const result = apply(lib, src(makeTrip({ days: {}, places: ['A'] })));
    const created = liveLabels(result).find((l) => l.name.value === '테스트 폴더')!;
    expect(created.color.value).toBe('orange'); // LABEL_COLORS[1 % 8]
    expect(created.icon.value).toBe('star');
    expect(created.order.value).toBe(5);
  });

  it('category uses effective category: edited string wins, null edit restores original', () => {
    const trip = trip2();
    const edit = makeEdit({
      places: {
        'n:1': { memos: {}, category: { value: '카페', updatedAt: T0 } },
        'n:2': { memos: {}, category: { value: null, updatedAt: T0 } },
      },
    });
    const p = plan(emptyLibrary(), src(trip, edit));
    expect(p.places.find((x) => x.placeKey === 'n:1')!.category).toBe('카페');
    expect(p.places.find((x) => x.placeKey === 'n:2')!.category).toBe('음식점');
    const result = applyImportPlan(emptyLibrary(), p);
    const byName = (n: string) => livePlaceList(result).find((x) => x.name.value === n)!;
    expect(byName('A').category.value).toBe('카페');
    expect(byName('B').category.value).toBe('음식점');
  });

  describe('legacyLabelSources', () => {
    it('lists folder and tag sources once each, in first-seen order', () => {
      const trip = makeTrip({ days: {}, places: ['A', 'B'] });
      const edit = makeEdit({
        places: { 'n:2': { memos: {}, tags: { value: [' 태그 '], updatedAt: T0 } } },
      });
      expect(legacyLabelSources(src(trip, edit))).toEqual([
        { key: 'folder:f1', rawName: '테스트 폴더' },
        { key: 'tag: 태그 ', rawName: ' 태그 ' },
      ]);
    });
  });

  describe('combineMemos', () => {
    const base = (): TripData => {
      const trip = makeTrip({ days: {}, places: ['A'] });
      trip.folders = [
        { id: 'f1', name: '폴더1', count: 1 },
        { id: 'f2', name: '폴더2', count: 1 },
      ];
      trip.places['n:1']!.folderIds = ['f1', 'f2'];
      return trip;
    };

    it('memo: skips empty and null(deleted), dedupes identical, single memo has no header', () => {
      const trip = base();
      trip.places['n:1']!.naverMemos = [
        { folderId: 'f1', memo: '' },
        { folderId: 'f2', memo: '같은 내용' },
      ];
      const edit = makeEdit({
        authors: {
          'a-local': { nickname: '나', updatedAt: T0 },
          'a-2': { nickname: '친구', updatedAt: T0 },
        },
        places: {
          'n:1': {
            memos: {
              'a-local': { text: '같은 내용', updatedAt: T0 },
              'a-2': { text: null, updatedAt: T0 },
            },
          },
        },
      });
      expect(combineMemos(src(trip, edit), 'n:1')).toBe('같은 내용');
    });

    it('memo: multiple get [네이버 · 폴더] / [닉네임] headers separated by blank line', () => {
      const trip = base();
      trip.places['n:1']!.naverMemos = [
        { folderId: 'f1', memo: '네이버 메모1' },
        { folderId: 'f2', memo: '네이버 메모2' },
      ];
      const edit = makeEdit({
        places: { 'n:1': { memos: { 'a-local': { text: '내 메모', updatedAt: T0 } } } },
      });
      expect(combineMemos(src(trip, edit), 'n:1')).toBe(
        ['[네이버 · 폴더1]\n네이버 메모1', '[네이버 · 폴더2]\n네이버 메모2', '[나]\n내 메모'].join(
          '\n\n',
        ),
      );
    });

    it('no memos gives empty string', () => {
      expect(combineMemos(src(base()), 'n:1')).toBe('');
    });
  });

  describe('label name decisions', () => {
    const longName = '가'.repeat(31);

    it('label name empty-after-trim or >30 creates pending decision and blocks apply', () => {
      const trip = makeTrip({ days: {}, places: ['A'] });
      trip.folders = [
        { id: 'f1', name: longName, count: 1 },
        { id: 'f2', name: '   ', count: 1 },
      ];
      trip.places['n:1']!.folderIds = ['f1', 'f2'];
      const p = plan(emptyLibrary(), src(trip));
      expect(p.summary.needsDecision).toBe(2);
      expect(p.pending).toEqual([
        { kind: 'label-name', key: 'folder:f1', suggested: '가'.repeat(30), reason: 'too-long' },
        { kind: 'label-name', key: 'folder:f2', suggested: '', reason: 'empty' },
      ]);
      expect(() => applyImportPlan(emptyLibrary(), p)).toThrow();
    });

    it('user-chosen name resolves a pending decision', () => {
      const trip = makeTrip({ days: {}, places: ['A'] });
      trip.folders = [{ id: 'f1', name: longName, count: 1 }];
      const choices: ImportChoices = {
        labels: { 'folder:f1': { kind: 'use', name: '  짧은 이름 ' } },
        memos: {},
      };
      const p = plan(emptyLibrary(), src(trip), choices);
      expect(p.pending).toEqual([]);
      const result = applyImportPlan(emptyLibrary(), p);
      expect(liveLabels(result).map((l) => l.name.value)).toEqual(['짧은 이름']);
    });

    it('a chosen name that is still invalid stays pending', () => {
      const trip = makeTrip({ days: {}, places: ['A'] });
      const choices: ImportChoices = {
        labels: { 'folder:f1': { kind: 'use', name: ' ' } },
        memos: {},
      };
      const p = plan(emptyLibrary(), src(trip), choices);
      expect(p.pending).toEqual([
        { kind: 'label-name', key: 'folder:f1', suggested: '', reason: 'empty' },
      ]);
    });

    it('label exclude keeps place without that label', () => {
      const trip = makeTrip({ days: {}, places: ['A'] });
      trip.folders = [{ id: 'f1', name: longName, count: 1 }];
      const choices: ImportChoices = { labels: { 'folder:f1': { kind: 'exclude' } }, memos: {} };
      const p = plan(emptyLibrary(), src(trip), choices);
      expect(p.pending).toEqual([]);
      const result = applyImportPlan(emptyLibrary(), p);
      expect(Object.keys(result.labels)).toHaveLength(0);
      const list = livePlaceList(result);
      expect(list).toHaveLength(1);
      expect(list[0]!.labelIds.value).toEqual([]);
    });

    it('tag keys use the raw tag text', () => {
      const trip = makeTrip({ days: {}, places: ['A'] });
      const edit = makeEdit({
        places: { 'n:1': { memos: {}, tags: { value: [' 태그 '], updatedAt: T0 } } },
      });
      const choices: ImportChoices = { labels: { 'tag: 태그 ': { kind: 'exclude' } }, memos: {} };
      const p = plan(emptyLibrary(), src(trip, edit), choices);
      expect(p.labels.map((l) => l.normalizedName)).toEqual(['테스트 폴더']);
    });
  });

  describe('memo length', () => {
    const tripWithMemo = (memo: string): TripData => {
      const trip = makeTrip({ days: {}, places: ['A'] });
      trip.places['n:1']!.naverMemos = [{ folderId: 'f1', memo }];
      return trip;
    };

    it('memo over 10000 creates pending; truncate yields length <= 10000 ending with TRUNCATION_MARK', () => {
      const long = '가'.repeat(10_001);
      const s = src(tripWithMemo(long));
      const first = plan(emptyLibrary(), s);
      expect(first.pending).toEqual([
        { kind: 'memo-too-long', placeKey: 'n:1', placeName: 'A', length: 10_001 },
      ]);
      expect(first.places[0]!.fullMemo).toBe(long);
      expect(() => applyImportPlan(emptyLibrary(), first)).toThrow();

      const choices: ImportChoices = { labels: {}, memos: { 'n:1': 'truncate' } };
      const p = plan(emptyLibrary(), s, choices);
      expect(p.pending).toEqual([]);
      const result = applyImportPlan(emptyLibrary(), p);
      const memo = livePlaceList(result)[0]!.memo.value;
      expect(memo.length).toBe(10_000);
      expect(memo.endsWith(TRUNCATION_MARK)).toBe(true);
      expect(safeParse(LibrarySchema, result).success).toBe(true);
    });

    it('memo of exactly 10000 needs no decision', () => {
      const p = plan(emptyLibrary(), src(tripWithMemo('가'.repeat(10_000))));
      expect(p.pending).toEqual([]);
    });

    it('memo exclude-place excludes the place', () => {
      const s = src(tripWithMemo('가'.repeat(10_001)));
      const p = plan(emptyLibrary(), s, { labels: {}, memos: { 'n:1': 'exclude-place' } });
      expect(p.places[0]!.action).toBe('exclude');
      expect(p.pending).toEqual([]);
      expect(p.summary).toMatchObject({ added: 0, existing: 0, newLabels: 0 });
      const result = applyImportPlan(emptyLibrary(), p);
      expect(Object.keys(result.places)).toHaveLength(0);
      expect(Object.keys(result.labels)).toHaveLength(0);
    });

    it('exclude-place stays excluded when another tab later saves a place with the same sid', () => {
      const s = src(tripWithMemo('가'.repeat(10_001)));
      const choices: ImportChoices = { labels: {}, memos: { 'n:1': 'exclude-place' } };
      const first = plan(emptyLibrary(), s, choices);
      expect(first.places[0]!.action).toBe('exclude');

      const lib = libWith([libPlace('exist00001')]); // sid '1'
      const second = plan(lib, s, choices, first.ids);
      expect(second.places[0]!.action).toBe('exclude');
      expect(semanticKey(second)).toBe(semanticKey(first));

      const result = applyImportPlan(lib, second);
      expect(result.places['exist00001']!.labelIds.value).toEqual([]);
      expect(Object.keys(result.labels)).toHaveLength(0);
    });

    it('a merged place needs no memo decision (memo is not imported)', () => {
      const lib = libWith([libPlace('exist00001')]);
      const p = plan(lib, src(tripWithMemo('가'.repeat(10_001))));
      expect(p.pending).toEqual([]);
      expect(p.places[0]!.action).toBe('merge');
    });
  });

  describe('truncateMemo', () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

    it('leaves short text alone', () => {
      expect(truncateMemo('짧은 메모')).toBe('짧은 메모');
      expect(truncateMemo('가'.repeat(10_000))).toBe('가'.repeat(10_000));
    });

    it('mark is 11 characters', () => {
      expect(TRUNCATION_MARK).toBe('…(원문 일부 생략)');
      expect(TRUNCATION_MARK.length).toBe(11);
    });

    it('truncate does not split surrogate pair', () => {
      // (a) 쌍이 절단점(9_989)에 걸침 → 한 단위 앞에서 자른다.
      const a = '가'.repeat(9_988) + '😀' + '나'.repeat(20);
      expect(a.length).toBeGreaterThan(10_000);
      const ta = truncateMemo(a);
      expect(ta.length).toBe(9_999);
      expect(ta.endsWith(TRUNCATION_MARK)).toBe(true);
      expect(lone.test(ta)).toBe(false);

      // (b) 쌍 전체가 절단점 뒤 → 보정 없음.
      const b = '가'.repeat(9_989) + '😀' + '나'.repeat(20);
      const tb = truncateMemo(b);
      expect(tb.length).toBe(10_000);
      expect(tb.endsWith(TRUNCATION_MARK)).toBe(true);
      expect(lone.test(tb)).toBe(false);
    });
  });

  describe('semanticKey', () => {
    it('semanticKey equal for unchanged library with reused ids', () => {
      const lib = libWith([libPlace('exist00001')]);
      const s = src();
      const preview = plan(lib, s);
      const again = plan(lib, s, NO_CHOICES, preview.ids);
      expect(semanticKey(again)).toBe(semanticKey(preview));
      expect(again.ids).toEqual(preview.ids);
      expect(() => applyImportPlan(lib, again)).not.toThrow();
    });

    it('semanticKey ignores freshly minted ids and now', () => {
      const s = src();
      const one = planLegacyImport(emptyLibrary(), s, NO_CHOICES, null, newId, NOW);
      const two = planLegacyImport(
        emptyLibrary(),
        s,
        NO_CHOICES,
        null,
        newId,
        '2026-10-10T00:00:00.000Z',
      );
      expect(one.ids).not.toEqual(two.ids);
      expect(semanticKey(one)).toBe(semanticKey(two));
    });

    it('semanticKey differs when another tab added a label with same name', () => {
      const s = src();
      const preview = plan(emptyLibrary(), s);
      const other = libWith([], [libLabel('lab00009', '테스트 폴더')]);
      const latest = plan(other, s, NO_CHOICES, preview.ids);
      expect(semanticKey(latest)).not.toBe(semanticKey(preview));
    });

    it('semanticKey differs when another tab added a place with same sid', () => {
      const s = src();
      const preview = plan(emptyLibrary(), s);
      const other = libWith([libPlace('exist00001')]);
      const latest = plan(other, s, NO_CHOICES, preview.ids);
      expect(semanticKey(latest)).not.toBe(semanticKey(preview));
    });

    it('semanticKey differs when choices change', () => {
      const s = src();
      const a = plan(emptyLibrary(), s);
      const b = plan(emptyLibrary(), s, {
        labels: { 'folder:f1': { kind: 'exclude' } },
        memos: {},
      });
      expect(semanticKey(a)).not.toBe(semanticKey(b));
    });

    it('ids are kept across replans and only new needs mint ids', () => {
      const s = src();
      const preview = plan(emptyLibrary(), s);
      const before = seq;
      const again = plan(emptyLibrary(), s, NO_CHOICES, preview.ids);
      expect(seq).toBe(before);
      const added = applyImportPlan(emptyLibrary(), again);
      expect(Object.keys(added.places).sort()).toEqual(Object.values(preview.ids.places).sort());
      expect(Object.keys(added.labels)).toEqual(Object.values(preview.ids.labels));
      expect(Object.values(added.places).every((p) => p.createdAt === NOW)).toBe(true);
    });
  });

  it('two legacy places with the same sid import as one place', () => {
    const trip = makeTrip({ days: {}, places: ['A'] });
    trip.places['c:dup'] = { ...trip.places['n:1']!, folderIds: [] };
    const p = plan(emptyLibrary(), src(trip));
    expect(p.summary).toMatchObject({ added: 1, existing: 1 });
    const result = applyImportPlan(emptyLibrary(), p);
    expect(livePlaceList(result)).toHaveLength(1);
    expect(safeParse(LibrarySchema, result).success).toBe(true);
  });

  it('imported places are saved: true and result passes LibrarySchema', () => {
    const result = apply(emptyLibrary(), src());
    const list = livePlaceList(result);
    expect(list).toHaveLength(2);
    for (const p of list) {
      expect(p.saved).toEqual({ value: true, updatedAt: NOW });
      expect(p.createdAt).toBe(NOW);
      expect(p.deletedAt).toBeNull();
    }
    expect(safeParse(LibrarySchema, result).success).toBe(true);
  });

  it('days are not imported', () => {
    const trip = makeTrip({ days: { '2026-11-14': ['A', 'B'] } });
    const result = apply(emptyLibrary(), src(trip));
    expect(result.trips).toEqual({});
  });

  it('summary counts', () => {
    const lib = libWith([libPlace('exist00001')]);
    const p = plan(lib, src());
    expect(p.summary).toEqual({ added: 1, existing: 1, newLabels: 1, needsDecision: 0 });
  });

  it('does not modify its inputs', () => {
    const lib = libWith([libPlace('exist00001')]);
    const s = src();
    const libCopy = structuredClone(lib);
    const srcCopy = structuredClone(s);
    apply(lib, s);
    expect(lib).toEqual(libCopy);
    expect(s).toEqual(srcCopy);
  });
});
