import { describe, expect, it } from 'vitest';
import { nextLabelColor } from 'src/domain/library/add-place';
import {
  appendReceivedMemo,
  cutLabelName,
  defaultTitleLabel,
  importShare,
  planShareImport,
  SHARE_MATCH_RADIUS_M,
  shareSource,
  type ShareImportInput,
} from 'src/domain/library/import-share';
import type { OpCtx, OpResult } from 'src/domain/library/ops';
import { haversineM } from 'src/domain/trips/geo';
import { safeParse } from 'src/schema/parse';
import {
  emptyLibrary,
  LibrarySchema,
  type Label,
  type Library,
  type Place,
} from 'src/schema/library';
import type { ShareDoc, ShareLabel, SharePlace } from 'src/schema/share';

const T0 = '2026-10-08T01:00:00.000Z';
const NOW = '2026-10-13T02:00:00.000Z';
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

const LNG = 128.95;
const LAT = 37.77;
/** 기준점에서 북쪽으로 `m`미터 떨어진 위도. */
const north = (m: number) => LAT + m / ((6_371_008.8 * Math.PI) / 180);

function place(id: string, over: Partial<Place> = {}): Place {
  return {
    id,
    source: { kind: 'pin' },
    name: f(`장소 ${id}`),
    address: '내 주소',
    lng: LNG,
    lat: LAT,
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

function sp(id: string, over: Partial<SharePlace> = {}): SharePlace {
  return {
    id,
    name: `받은 ${id}`,
    address: '받은 주소',
    lng: LNG,
    lat: LAT,
    labelIds: [],
    ...over,
  };
}

function sl(id: string, name: string, order = 0, color: ShareLabel['color'] = 'blue'): ShareLabel {
  return { id, name, color, order };
}

function doc(places: SharePlace[], labels: ShareLabel[] = [], title = '강릉 모음'): ShareDoc {
  return {
    format: 'tripmap-share',
    version: 1,
    title,
    createdAt: T0,
    labels,
    places,
  };
}

const allIds = (d: ShareDoc) => d.places.map((p) => p.id);

function ok(r: OpResult): Extract<OpResult, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got ${r.error._tag}`);
  return r;
}

/** 모든 결과 문서가 `LibrarySchema`를 통과하는지 함께 확인한다. */
function run(
  before: Library,
  d: ShareDoc,
  over: Partial<ShareImportInput> = {},
  ctx: OpCtx = makeCtx(),
): Extract<OpResult, { ok: true }> {
  const r = ok(
    importShare(
      before,
      d,
      { selected: allIds(d), titleLabel: null, appendMemo: true, ...over },
      ctx,
    ),
  );
  expect(safeParse(LibrarySchema, r.lib).success).toBe(true);
  return r;
}

const P1 = 'place00001';
const P2 = 'place00002';
const P3 = 'place00003';
const A = 'labelaaa';
const B = 'labelbbb';
const HEAD = '— 받은 메모 (강릉 모음):\n';

describe('cutLabelName / defaultTitleLabel', () => {
  it('앞뒤 공백을 지우고 30자로 자르며 서로게이트 쌍을 깨지 않는다', () => {
    expect(cutLabelName('  강릉  ')).toBe('강릉');
    expect(cutLabelName('a'.repeat(31))).toBe('a'.repeat(30));
    expect(cutLabelName(`${'a'.repeat(29)}😀`)).toBe('a'.repeat(29));
  });

  it('제목이 비면 받은 장소', () => {
    expect(defaultTitleLabel('   ')).toBe('받은 장소');
    expect(defaultTitleLabel(' 강릉 모음 ')).toBe('강릉 모음');
  });
});

describe('shareSource', () => {
  it('naverSid → kakaoId → googleId 순, 형식이 틀리면 건너뛰고 없으면 핀', () => {
    expect(shareSource(sp('s', { naverSid: '1', kakaoId: '2' }))).toEqual({
      kind: 'naver',
      sid: '1',
    });
    expect(shareSource(sp('s', { naverSid: 'abc', kakaoId: '2' }))).toEqual({
      kind: 'kakao',
      kakaoId: '2',
    });
    expect(shareSource(sp('s', { googleId: '0x1a:0x2b' }))).toEqual({
      kind: 'google',
      googleId: '0x1a:0x2b',
    });
    expect(shareSource(sp('s', { googleId: 'ChIJ' }))).toEqual({ kind: 'pin' });
    expect(shareSource(sp('s'))).toEqual({ kind: 'pin' });
  });
});

describe('importShare — 같은 장소 찾기', () => {
  it('같은 naverSid의 살아 있는 장소에 합친다', () => {
    const before = lib([place(P1, { source: { kind: 'naver', sid: '7' } })]);
    const r = run(before, doc([sp('s', { naverSid: '7' })]));
    expect(Object.keys(r.lib.places)).toEqual([P1]);
    expect(r.summary).toEqual({ created: 0, merged: 1, restored: 0 });
  });

  it('지운 장소만 있으면 되살린다', () => {
    const before = lib([place(P1, { source: { kind: 'naver', sid: '7' }, deletedAt: T0 })]);
    const r = run(before, doc([sp('s', { naverSid: '7' })]));
    expect(r.lib.places[P1]!.deletedAt).toBeNull();
    expect(Object.keys(r.lib.places)).toEqual([P1]);
    expect(r.summary).toEqual({ created: 0, merged: 0, restored: 1 });
  });

  it('naverSid 형식이 틀리면 이름+거리로 찾는다', () => {
    const before = lib([place(P1, { name: f('테라로사') })]);
    const r = run(before, doc([sp('s', { name: '테라로사', naverSid: 'abc' })]));
    expect(Object.keys(r.lib.places)).toEqual([P1]);
    expect(r.summary).toEqual({ created: 0, merged: 1, restored: 0 });
  });

  it('핀: 같은 이름 49m는 합치고 51m는 새로 만든다', () => {
    expect(haversineM([LNG, LAT], [LNG, north(49)])).toBeLessThan(SHARE_MATCH_RADIUS_M);
    expect(haversineM([LNG, LAT], [LNG, north(51)])).toBeGreaterThan(SHARE_MATCH_RADIUS_M);
    const before = lib([place(P1, { name: f('테라로사') })]);
    const near = run(before, doc([sp('s', { name: '테라로사', lat: north(49) })]));
    expect(near.summary).toEqual({ created: 0, merged: 1, restored: 0 });
    const far = run(before, doc([sp('s', { name: '테라로사', lat: north(51) })]));
    expect(far.summary).toEqual({ created: 1, merged: 0, restored: 0 });
    expect(Object.keys(far.lib.places)).toHaveLength(2);
  });

  it('이름은 정규형으로 비교한다', () => {
    const before = lib([place(P1, { name: f('테라로사 강릉점') })]);
    const r = run(before, doc([sp('s', { name: ' 테라로사  강릉점 ' })]));
    expect(r.summary).toEqual({ created: 0, merged: 1, restored: 0 });
  });

  it('후보가 여럿이면 살아 있는 것 > 가까운 것, 범위 밖은 제외', () => {
    const name = f('테라로사');
    const before = lib([
      place(P1, { name, lat: north(40) }),
      place(P2, { name, lat: north(10), deletedAt: T0 }),
      place(P3, { name, lat: north(70) }),
    ]);
    const r = run(before, doc([sp('s', { name: '테라로사' })]), { titleLabel: '모음' });
    expect(r.lib.places[P1]!.labelIds.value).toEqual([r.createdId]);
    expect(r.lib.places[P2]!.deletedAt).toBe(T0);
    expect(r.lib.places[P3]!.labelIds.value).toEqual([]);
  });

  it('id가 있는 받은 장소는 이름이 같은 핀이 옆에 있어도 새로 만든다', () => {
    const before = lib([place(P1, { name: f('테라로사') })]);
    const r = run(before, doc([sp('s', { name: '테라로사', naverSid: '7' })]));
    expect(r.summary).toEqual({ created: 1, merged: 0, restored: 0 });
    expect(Object.keys(r.lib.places)).toHaveLength(2);
  });

  it('이름으로 찾은 지운 장소의 출처를 살아 있는 장소가 쓰고 있으면 되살리지 않는다', () => {
    const before = lib([
      place(P1, { name: f('테라로사'), source: { kind: 'naver', sid: '7' }, deletedAt: T0 }),
      place(P2, { name: f('다른 곳'), source: { kind: 'naver', sid: '7' }, lat: north(500) }),
    ]);
    const r = run(before, doc([sp('s', { name: '테라로사' })]));
    expect(r.lib.places[P1]!.deletedAt).toBe(T0);
    expect(r.summary).toEqual({ created: 1, merged: 0, restored: 0 });
  });
});

describe('importShare — 파일 안 중복', () => {
  it('같은 핀 두 개는 장소 하나', () => {
    const r = run(lib([]), doc([sp('a', { name: '핀' }), sp('b', { name: '핀', lat: north(5) })]));
    expect(Object.keys(r.lib.places)).toHaveLength(1);
    expect(r.summary).toEqual({ created: 1, merged: 0, restored: 0 });
  });

  it('같은 naverSid 두 번도 장소 하나', () => {
    const r = run(
      lib([]),
      doc([sp('a', { naverSid: '7' }), sp('b', { naverSid: '7', name: '딴' })]),
    );
    expect(Object.keys(r.lib.places)).toHaveLength(1);
    expect(r.summary).toEqual({ created: 1, merged: 0, restored: 0 });
  });
});

describe('importShare — 새 장소', () => {
  it('이름·주소·좌표·메모를 그대로, 분류 null, saved true', () => {
    const r = run(
      lib([]),
      doc([sp('a', { name: '이름', address: '주소', lng: 128.5, lat: 37.5, memo: '메모' })]),
      { appendMemo: false },
    );
    const p = Object.values(r.lib.places)[0]!;
    expect(p.name.value).toBe('이름');
    expect(p.address).toBe('주소');
    expect([p.lng, p.lat]).toEqual([128.5, 37.5]);
    expect(p.memo.value).toBe('메모');
    expect(p.category.value).toBeNull();
    expect(p.saved.value).toBe(true);
    expect(p.source).toEqual({ kind: 'pin' });
  });

  it('카카오 id면 카카오 출처', () => {
    const r = run(lib([]), doc([sp('a', { kakaoId: '123' })]));
    expect(Object.values(r.lib.places)[0]!.source).toEqual({ kind: 'kakao', kakaoId: '123' });
  });

  it('메모 10,001자는 10,000자로 자르고 …로 끝난다', () => {
    const r = run(lib([]), doc([sp('a', { memo: 'm'.repeat(10_001) })]));
    const memo = Object.values(r.lib.places)[0]!.memo.value;
    expect(memo).toHaveLength(10_000);
    expect(memo.endsWith('…')).toBe(true);
  });
});

describe('importShare — 라벨', () => {
  it('정규형이 같은 살아 있는 라벨은 재사용하고(색 그대로) 없으면 받은 색으로 만든다', () => {
    const before = lib([], [label(A, 'Cafe', 0)]);
    const d = doc(
      [sp('a', { labelIds: ['x', 'y'] })],
      [sl('x', ' cafe '), sl('y', '바다', 1, 'teal')],
    );
    const r = run(before, d);
    const p = Object.values(r.lib.places)[0]!;
    expect(p.labelIds.value[0]).toBe(A);
    expect(r.lib.labels[A]!.color.value).toBe('red');
    const made = r.lib.labels[p.labelIds.value[1]!]!;
    expect(made.name.value).toBe('바다');
    expect(made.color.value).toBe('teal');
    expect(made.order.value).toBe(1);
  });

  it('31자 이름은 30자로, 빈 이름은 무시, 없는 id는 무시', () => {
    const d = doc(
      [sp('a', { labelIds: ['x', 'y', 'nope'] })],
      [sl('x', 'a'.repeat(31)), sl('y', '   ', 1)],
    );
    const r = run(lib([]), d);
    const labels = Object.values(r.lib.labels);
    expect(labels.map((l) => l.name.value)).toEqual(['a'.repeat(30)]);
    expect(Object.values(r.lib.places)[0]!.labelIds.value).toEqual([labels[0]!.id]);
  });

  it('받은 라벨 Cafe·cafe는 한 라벨', () => {
    const d = doc([sp('a', { labelIds: ['x', 'y'] })], [sl('x', 'Cafe'), sl('y', 'cafe', 1)]);
    const r = run(lib([]), d);
    expect(Object.values(r.lib.labels)).toHaveLength(1);
    expect(Object.values(r.lib.places)[0]!.labelIds.value).toHaveLength(1);
  });

  it('고르지 않은 장소만 쓰는 라벨은 만들지 않는다', () => {
    const d = doc(
      [sp('a', { labelIds: ['x'] }), sp('b', { labelIds: ['y'], name: '딴' })],
      [sl('x', '고름'), sl('y', '안 고름', 1)],
    );
    const r = run(lib([]), d, { selected: ['a'] });
    expect(Object.values(r.lib.labels).map((l) => l.name.value)).toEqual(['고름']);
    expect(Object.keys(r.lib.places)).toHaveLength(1);
  });

  it('제목 라벨을 켜면 모든 결과 장소에 붙고 createdId, 색은 nextLabelColor', () => {
    const before = lib([place(P1, { name: f('있음') })], [label(A, '빨강', 0)]);
    const d = doc([sp('a', { name: '있음' }), sp('b', { name: '새 곳' })]);
    const r = run(before, d, { titleLabel: '강릉 모음' });
    const title = r.lib.labels[r.createdId!]!;
    expect(title.name.value).toBe('강릉 모음');
    expect(title.color.value).toBe(nextLabelColor(before));
    for (const p of Object.values(r.lib.places)) expect(p.labelIds.value).toContain(title.id);
  });

  it('제목 라벨은 받은 라벨보다 먼저 정해진다(색이 입력 문서 기준)', () => {
    const d = doc([sp('a', { labelIds: ['x'] })], [sl('x', '받은', 0, 'red')]);
    const r = run(lib([]), d, { titleLabel: '모음' });
    expect(r.lib.labels[r.createdId!]!.color.value).toBe(nextLabelColor(lib([])));
    expect(r.lib.labels[r.createdId!]!.order.value).toBe(0);
  });

  it('제목 라벨 이름이 같은 내 라벨이면 재사용', () => {
    const before = lib([], [label(A, '강릉 모음', 0)]);
    const r = run(before, doc([sp('a')]), { titleLabel: ' 강릉  모음 ' });
    expect(r.createdId).toBe(A);
    expect(Object.keys(r.lib.labels)).toEqual([A]);
  });

  it('제목 라벨을 끄면 붙지 않고 createdId 없음', () => {
    const r = run(lib([]), doc([sp('a')]));
    expect(r.createdId).toBeUndefined();
    expect(Object.keys(r.lib.labels)).toHaveLength(0);
  });

  it.each(['', '   ', 'a'.repeat(31)])(
    '제목 라벨 이름이 1–30자가 아니면 LabelNameInvalid (%j)',
    (name) => {
      expect(
        importShare(
          lib([]),
          doc([sp('a')]),
          { selected: ['a'], titleLabel: name, appendMemo: true },
          makeCtx(),
        ),
      ).toEqual({ ok: false, error: { _tag: 'LabelNameInvalid', name } });
    },
  );
});

describe('importShare — 이미 있는 장소에 합치기', () => {
  it('라벨은 기존 뒤에 중복 없이, saved false → true, 이름·주소·좌표·분류 그대로', () => {
    const before = lib(
      [
        place(P1, {
          source: { kind: 'naver', sid: '7' },
          labelIds: f([A, B]),
          saved: f(false),
        }),
      ],
      [label(A, '하나', 0), label(B, '둘', 1)],
    );
    const d = doc(
      [
        sp('s', {
          naverSid: '7',
          name: '딴 이름',
          address: '딴 주소',
          lng: 128,
          lat: 37,
          labelIds: ['x', 'y'],
        }),
      ],
      [sl('x', '둘'), sl('y', '셋', 1)],
    );
    const r = run(before, d);
    const p = r.lib.places[P1]!;
    expect(p.labelIds.value).toEqual([A, B, p.labelIds.value[2]]);
    expect(r.lib.labels[p.labelIds.value[2]!]!.name.value).toBe('셋');
    expect(p.saved.value).toBe(true);
    expect(p.name.value).toBe('장소 place00001');
    expect(p.address).toBe('내 주소');
    expect([p.lng, p.lat]).toEqual([LNG, LAT]);
    expect(p.category.value).toBe('카페');
  });

  it('되살릴 때 지워진 라벨을 뗀다', () => {
    const before = lib(
      [place(P1, { source: { kind: 'naver', sid: '7' }, labelIds: f([A, B]), deletedAt: T0 })],
      [label(A, '하나', 0), label(B, '둘', 1, { deletedAt: T0 })],
    );
    const r = run(before, doc([sp('s', { naverSid: '7' })]));
    expect(r.lib.places[P1]!.labelIds.value).toEqual([A]);
  });
});

describe('appendReceivedMemo', () => {
  it('빈 메모면 블록만, 있으면 빈 줄 하나로 잇는다', () => {
    expect(appendReceivedMemo('', '강릉 모음', '받은')).toBe(`${HEAD}받은`);
    expect(appendReceivedMemo('기존', '강릉 모음', '받은')).toBe(`기존\n\n${HEAD}받은`);
  });

  it('받은 메모 원문이 기존 메모 어디에든 있으면 그대로', () => {
    expect(appendReceivedMemo('받은', '강릉 모음', '받은')).toBe('받은');
    const memo = `x\n\n${HEAD}받은\n\n— 받은 메모 (B):\nb`;
    expect(appendReceivedMemo(memo, '강릉 모음', '받은')).toBe(memo);
  });

  it('받은 메모가 비면 그대로', () => {
    expect(appendReceivedMemo('기존', '강릉 모음', '')).toBe('기존');
  });

  it('머리 줄은 17자', () => {
    expect(HEAD).toHaveLength(17);
  });

  it('넘치면 받은 메모를 잘라 …로 끝내 정확히 10,000자', () => {
    const current = 'a'.repeat(9_900);
    const out = appendReceivedMemo(current, '강릉 모음', 'b'.repeat(200));
    expect(out).toHaveLength(10_000);
    expect(out.startsWith(`${current}\n\n${HEAD}b`)).toBe(true);
    expect(out.endsWith('…')).toBe(true);
  });

  it('9,980자면 머리 줄과 …만 붙어 10,000자', () => {
    const current = 'a'.repeat(9_980);
    const out = appendReceivedMemo(current, '강릉 모음', 'b'.repeat(200));
    expect(out).toBe(`${current}\n\n${HEAD}…`);
    expect(out).toHaveLength(10_000);
  });

  it.each([9_981, 9_990])('%i자면 그대로', (n) => {
    const current = 'a'.repeat(n);
    expect(appendReceivedMemo(current, '강릉 모음', 'b'.repeat(200))).toBe(current);
  });

  it('빈 기존 메모 + 받은 10,000자 → 10,000자, …로 끝남', () => {
    const out = appendReceivedMemo('', '강릉 모음', 'b'.repeat(10_000));
    expect(out).toHaveLength(10_000);
    expect(out.endsWith('…')).toBe(true);
  });

  it('자르는 곳의 서로게이트 쌍을 깨지 않는다', () => {
    // 받은 메모에 남길 수 있는 길이는 10,000 - 9,900 - 2 - 17 - 1 = 80. 79·80번째가 이모지 한 개다.
    const out = appendReceivedMemo(
      'a'.repeat(9_900),
      '강릉 모음',
      `${'b'.repeat(79)}${'😀'.repeat(50)}`,
    );
    expect(out).toHaveLength(9_999);
    expect(out.endsWith('b…')).toBe(true);
  });
});

describe('importShare — 메모', () => {
  const before = () => lib([place(P1, { source: { kind: 'naver', sid: '7' }, memo: f('기존') })]);

  it('켜면 이미 있는 장소에 블록을 덧붙인다', () => {
    const r = run(before(), doc([sp('s', { naverSid: '7', memo: '받은' })]));
    expect(r.lib.places[P1]!.memo.value).toBe(`기존\n\n${HEAD}받은`);
  });

  it('끄면 그대로', () => {
    const r = run(before(), doc([sp('s', { naverSid: '7', memo: '받은' })]), { appendMemo: false });
    expect(r.lib.places[P1]!.memo).toEqual(f('기존'));
  });

  it('새 장소에는 토글과 상관없이 받은 메모', () => {
    const r = run(lib([]), doc([sp('s', { memo: '받은' })]), { appendMemo: false });
    expect(Object.values(r.lib.places)[0]!.memo.value).toBe('받은');
  });
});

describe('importShare — 같은 파일을 다시 가져오기', () => {
  it('두 번째는 모두 merged이고 장소·라벨·메모가 그대로', () => {
    const first = lib([place(P1, { source: { kind: 'naver', sid: '7' }, memo: f('기존') })]);
    const d = doc(
      [
        sp('a', { naverSid: '7', memo: '합칠 메모', labelIds: ['x'] }),
        sp('b', { name: '새 핀', memo: '새 메모', labelIds: ['x'] }),
      ],
      [sl('x', '바다')],
    );
    const ctx = makeCtx();
    const once = run(first, d, { titleLabel: '강릉 모음' }, ctx);
    const twice = run(once.lib, d, { titleLabel: '강릉 모음' }, ctx);
    expect(twice.summary).toEqual({ created: 0, merged: 2, restored: 0 });
    expect(twice.lib.places).toEqual(once.lib.places);
    expect(twice.lib.labels).toEqual(once.lib.labels);
  });

  it('A → B → A: 세 번째 뒤 메모가 두 번째 뒤와 같다', () => {
    const start = lib([place(P1, { source: { kind: 'naver', sid: '7' }, memo: f('기존') })]);
    const a = doc([sp('s', { naverSid: '7', memo: '에이' })], [], 'A');
    const b = doc([sp('s', { naverSid: '7', memo: '비' })], [], 'B');
    const ctx = makeCtx();
    const second = run(run(start, a, {}, ctx).lib, b, {}, ctx);
    const third = run(second.lib, a, {}, ctx);
    expect(third.lib.places[P1]!.memo.value).toBe(second.lib.places[P1]!.memo.value);
    expect(second.lib.places[P1]!.memo.value).toBe(
      '기존\n\n— 받은 메모 (A):\n에이\n\n— 받은 메모 (B):\n비',
    );
  });
});

describe('importShare — 동시성', () => {
  it('미리보기 뒤 다른 탭이 넣은 같은 naverSid 장소에 합치고 merged로 센다', () => {
    const shown = lib([]);
    const d = doc([sp('s', { naverSid: '7' })]);
    expect(planShareImport(shown, d, ['s'], null).existing.size).toBe(0);
    const latest = lib([place(P1, { source: { kind: 'naver', sid: '7' } })]);
    const r = run(latest, d);
    expect(Object.keys(r.lib.places)).toEqual([P1]);
    expect(r.summary).toEqual({ created: 0, merged: 1, restored: 0 });
  });
});

describe('planShareImport', () => {
  it('existing에는 살아 있는 장소와 같은 것만', () => {
    const before = lib([
      place(P1, { source: { kind: 'naver', sid: '1' } }),
      place(P2, { source: { kind: 'naver', sid: '2' }, deletedAt: T0 }),
      place(P3, { name: f('핀') }),
    ]);
    const d = doc([
      sp('a', { naverSid: '1' }),
      sp('b', { naverSid: '2' }),
      sp('c', { name: '핀' }),
      sp('d', { name: '없음' }),
    ]);
    expect([...planShareImport(before, d, allIds(d), null).existing]).toEqual(['a', 'c']);
  });

  it('labels: 고른 장소가 쓰는 라벨을 order 순으로, reuse 표시, 빈 이름 제외', () => {
    const before = lib([], [label(A, '바다', 0)]);
    const d = doc(
      [sp('a', { labelIds: ['y', 'x', 'e'] }), sp('b', { labelIds: ['z'] })],
      [
        sl('x', '바다', 2, 'teal'),
        sl('y', '산', 1, 'green'),
        sl('z', '안 고름', 0),
        sl('e', ' ', 3),
      ],
    );
    expect(planShareImport(before, d, ['a'], null).labels).toEqual([
      { shareLabelId: 'y', name: '산', color: 'green', reuse: false },
      { shareLabelId: 'x', name: '바다', color: 'teal', reuse: true },
    ]);
  });

  it('titleReuse', () => {
    const before = lib([], [label(A, '강릉 모음', 0)]);
    const d = doc([sp('a')]);
    expect(planShareImport(before, d, ['a'], '강릉  모음').titleReuse).toBe(true);
    expect(planShareImport(before, d, ['a'], '다른 이름').titleReuse).toBe(false);
    expect(planShareImport(before, d, ['a'], null).titleReuse).toBe(false);
  });
});
