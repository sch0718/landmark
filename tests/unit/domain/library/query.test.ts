import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUERY,
  labelCounts,
  liveLabels,
  livePlaces,
  queryPlaces,
  regionCounts,
  searchPlaces,
  hasVisited,
  sortByVisited,
  visitCounts,
  type LibraryQuery,
} from 'src/domain/library/query';
import { emptyLibrary, type Label, type Library, type Place } from 'src/schema/library';

const T = '2026-10-08T01:00:00.000Z';
const f = <V>(value: V, updatedAt = T) => ({ value, updatedAt });

let seq = 0;
function place(
  over: Partial<Omit<Place, 'name'>> & { labels?: string[]; name?: string } = {},
): Place {
  const { labels, name, ...rest } = over;
  const n = seq++;
  return {
    id: `p${String(n).padStart(9, '0')}`,
    source: { kind: 'naver', sid: String(1000 + n) },
    name: f(name ?? `장소${n}`),
    address: '강원특별자치도 강릉시 난설헌로 131',
    lng: 128.95,
    lat: 37.77,
    category: f<string | null>(null),
    labelIds: f<string[]>(labels ?? []),
    memo: f(''),
    saved: f(true),
    createdAt: T,
    deletedAt: null,
    ...rest,
  };
}

function label(id: string, name: string, order: number, over: Partial<Label> = {}): Label {
  return {
    id,
    name: f(name),
    color: f('red' as const),
    icon: f('star' as const),
    order: f(order),
    createdAt: T,
    deletedAt: null,
    ...over,
  };
}

function library(places: Place[], labels: Label[] = []): Library {
  return {
    ...emptyLibrary(),
    places: Object.fromEntries(places.map((p) => [p.id, p])),
    labels: Object.fromEntries(labels.map((l) => [l.id, l])),
  };
}

const q = (over: Partial<LibraryQuery> = {}): LibraryQuery => ({ ...DEFAULT_QUERY, ...over });
const names = (ps: Place[]) => ps.map((p) => p.name.value);

const FOOD = label('food0001', 'TV맛집', 1);
const CAFE = label('cafe0001', '카페', 2);
const VIEW = label('view0001', '전망', 3);

describe('livePlaces / liveLabels', () => {
  it('hides deleted and unsaved places', () => {
    const lib = library([
      place({ name: '보임' }),
      place({ name: '삭제됨', deletedAt: T }),
      place({ name: '저장 해제', saved: f(false) }),
    ]);
    expect(names(livePlaces(lib))).toEqual(['보임']);
    expect(names(queryPlaces(lib, q()))).toEqual(['보임']);
  });

  it('liveLabels skips deleted labels and sorts by order', () => {
    const lib = library([], [VIEW, label('gone0001', '삭제', 0, { deletedAt: T }), FOOD, CAFE]);
    expect(liveLabels(lib).map((l) => l.id)).toEqual(['food0001', 'cafe0001', 'view0001']);
  });
});

describe('queryPlaces label filter', () => {
  const lib = library(
    [
      place({ name: 'A', labels: ['food0001'] }),
      place({ name: 'B', labels: ['food0001', 'cafe0001'] }),
      place({ name: 'C', labels: ['cafe0001'] }),
      place({ name: 'D' }),
    ],
    [FOOD, CAFE, VIEW],
  );

  it('any mode returns places with at least one selected label', () => {
    const r = queryPlaces(
      lib,
      q({ labelIds: ['food0001', 'cafe0001'], mode: 'any', sort: 'name' }),
    );
    expect(names(r)).toEqual(['A', 'B', 'C']);
  });

  it('all mode returns places with every selected label', () => {
    const r = queryPlaces(lib, q({ labelIds: ['food0001', 'cafe0001'], mode: 'all' }));
    expect(names(r)).toEqual(['B']);
  });

  it('unlabeled returns only places without labels', () => {
    expect(names(queryPlaces(lib, q({ unlabeled: true })))).toEqual(['D']);
  });

  it('unlabeled ignores labelIds', () => {
    expect(names(queryPlaces(lib, q({ unlabeled: true, labelIds: ['food0001'] })))).toEqual(['D']);
  });

  it('treats labels that are deleted as absent', () => {
    const gone = label('gone0001', '삭제', 9, { deletedAt: T });
    const l = library([place({ name: 'E', labels: ['gone0001'] })], [gone]);
    expect(names(queryPlaces(l, q({ unlabeled: true })))).toEqual(['E']);
  });
});

describe('queryPlaces region and text', () => {
  const lib = library(
    [
      place({ name: '강릉1', address: '강원특별자치도 강릉시 A', labels: ['food0001'] }),
      place({ name: '강릉2', address: '강원특별자치도 강릉시 B', labels: ['cafe0001'] }),
      place({ name: '양양1', address: '강원도 양양군 C', labels: ['food0001'] }),
      place({ name: '서울1', address: '서울특별시 강남구 D', labels: ['food0001'] }),
    ],
    [FOOD, CAFE],
  );

  it('regions OR together and AND with labels', () => {
    const regions = queryPlaces(lib, q({ regions: ['강릉', '양양'], sort: 'name' }));
    expect(names(regions)).toEqual(['강릉1', '강릉2', '양양1']);
    const both = queryPlaces(
      lib,
      q({ regions: ['강릉', '양양'], labelIds: ['food0001'], sort: 'name' }),
    );
    expect(names(both)).toEqual(['강릉1', '양양1']);
  });

  it('text matches name, address, memo and label names case-insensitively', () => {
    const l = library(
      [
        place({ name: 'Sunrise Cafe' }),
        place({ name: '주소매치', address: '강원특별자치도 속초시 영랑해안길' }),
        place({ name: '메모매치', memo: f('오픈런 필수') }),
        place({ name: '라벨매치', labels: ['food0001'] }),
        place({ name: '없음' }),
      ],
      [FOOD],
    );
    expect(names(queryPlaces(l, q({ text: 'SUNRISE' })))).toEqual(['Sunrise Cafe']);
    expect(names(queryPlaces(l, q({ text: '영랑' })))).toEqual(['주소매치']);
    expect(names(queryPlaces(l, q({ text: '오픈런' })))).toEqual(['메모매치']);
    expect(names(queryPlaces(l, q({ text: 'tv맛' })))).toEqual(['라벨매치']);
  });

  it('normalizes Korean text (NFD input matches NFC data) and ignores surrounding spaces', () => {
    const l = library([place({ name: '안목해변 카페' })]);
    expect(names(queryPlaces(l, q({ text: '  안목'.normalize('NFD') })))).toEqual([
      '안목해변 카페',
    ]);
  });

  it('does not match deleted label names', () => {
    const gone = label('gone0001', '숨김라벨', 9, { deletedAt: T });
    const l = library([place({ name: 'X', labels: ['gone0001'] })], [gone]);
    expect(queryPlaces(l, q({ text: '숨김' }))).toEqual([]);
  });
});

describe('queryPlaces sort', () => {
  it('sort recent: latest saved first, then newer createdAt', () => {
    const old = place({ name: '오래', saved: f(true, '2026-10-01T00:00:00.000Z') });
    const mid = place({ name: '중간', saved: f(true, '2026-10-05T00:00:00.000Z') });
    const resaved = place({
      name: '다시저장',
      createdAt: '2026-09-01T00:00:00.000Z',
      saved: f(true, '2026-10-07T00:00:00.000Z'),
    });
    expect(names(queryPlaces(library([old, mid, resaved]), q()))).toEqual([
      '다시저장',
      '중간',
      '오래',
    ]);
  });

  it('sort name uses Korean collation', () => {
    const lib = library([
      place({ name: '다' }),
      place({ name: '가' }),
      place({ name: '나' }),
      place({ name: 'b' }),
    ]);
    expect(names(queryPlaces(lib, q({ sort: 'name' })))).toEqual(
      ['가', '나', '다', 'b'].sort((a, b) => a.localeCompare(b, 'ko')),
    );
  });

  it('sort label: representative label (first in labelIds) order, then name; unlabeled last', () => {
    const lib = library(
      [
        place({ name: '무라벨' }),
        place({ name: '카페가', labels: ['cafe0001'] }),
        place({ name: '맛집나', labels: ['food0001'] }),
        place({ name: '맛집가', labels: ['cafe0001', 'food0001'] }),
        place({ name: '맛집다', labels: ['food0001'] }),
      ],
      [FOOD, CAFE],
    );
    // 맛집가는 labelIds의 첫 번째가 카페이므로 카페 그룹(order 2)에 속한다.
    expect(names(queryPlaces(lib, q({ sort: 'label' })))).toEqual([
      '맛집나',
      '맛집다',
      '맛집가',
      '카페가',
      '무라벨',
    ]);
  });

  it('sort label skips deleted labels in labelIds to find the representative', () => {
    const gone = label('gone0001', '삭제', 0, { deletedAt: T });
    const lib = library(
      [
        place({ name: '둘째가 대표', labels: ['gone0001', 'cafe0001'] }),
        place({ name: '맛집', labels: ['food0001'] }),
        place({ name: '삭제만', labels: ['gone0001'] }),
      ],
      [FOOD, CAFE, gone],
    );
    expect(names(queryPlaces(lib, q({ sort: 'label' })))).toEqual([
      '맛집',
      '둘째가 대표',
      '삭제만',
    ]);
  });

  it('sort label falls back to recent when label and name are equal', () => {
    const older = place({
      name: '같은이름',
      labels: ['food0001'],
      saved: f(true, '2026-10-01T00:00:00.000Z'),
    });
    const newer = place({
      name: '같은이름',
      labels: ['food0001'],
      saved: f(true, '2026-10-05T00:00:00.000Z'),
    });
    const lib = library([older, newer], [FOOD]);
    expect(queryPlaces(lib, q({ sort: 'label' })).map((p) => p.id)).toEqual([newer.id, older.id]);
    const lib2 = library([newer, older], [FOOD]);
    expect(queryPlaces(lib2, q({ sort: 'label' })).map((p) => p.id)).toEqual([newer.id, older.id]);
  });

  it('sort label breaks ties between equal order by label name', () => {
    const a = label('aaaa0001', '가라벨', 1);
    const b = label('bbbb0001', '나라벨', 1);
    const lib = library(
      [place({ name: 'P', labels: ['bbbb0001'] }), place({ name: 'Q', labels: ['aaaa0001'] })],
      [a, b],
    );
    expect(names(queryPlaces(lib, q({ sort: 'label' })))).toEqual(['Q', 'P']);
  });

  it('does not mutate the library', () => {
    const lib = library([place({ name: '나' }), place({ name: '가' })], [FOOD]);
    const before = JSON.stringify(lib);
    queryPlaces(lib, q({ sort: 'name', text: '가' }));
    labelCounts(lib, q());
    regionCounts(lib, q());
    expect(JSON.stringify(lib)).toBe(before);
  });
});

describe('labelCounts', () => {
  const lib = library(
    [
      place({ name: '강릉 맛집', address: '강원특별자치도 강릉시 A', labels: ['food0001'] }),
      place({
        name: '강릉 카페',
        address: '강원특별자치도 강릉시 B',
        labels: ['cafe0001', 'food0001'],
      }),
      place({ name: '양양 카페', address: '강원도 양양군 C', labels: ['cafe0001'] }),
      place({ name: '양양 무라벨', address: '강원도 양양군 D' }),
      place({ name: '삭제', address: '강원도 양양군 E', labels: ['cafe0001'], deletedAt: T }),
    ],
    [FOOD, CAFE, VIEW],
  );

  it('labelCounts ignores label filter but applies text and region', () => {
    const base = labelCounts(lib, q());
    expect(base.get('food0001')).toBe(2);
    expect(base.get('cafe0001')).toBe(2);
    expect(base.get('view0001')).toBe(0);
    expect(base.get('unlabeled')).toBe(1);

    // 라벨 필터는 숫자에 영향이 없다.
    expect(labelCounts(lib, q({ labelIds: ['food0001'], mode: 'all', unlabeled: true }))).toEqual(
      base,
    );

    const region = labelCounts(lib, q({ regions: ['양양'] }));
    expect(region.get('food0001')).toBe(0);
    expect(region.get('cafe0001')).toBe(1);
    expect(region.get('unlabeled')).toBe(1);

    const text = labelCounts(lib, q({ text: '카페' }));
    // 이름 또는 라벨 이름 '카페'가 맞는 장소: 강릉 카페, 양양 카페 + 라벨명 카페를 가진 장소들
    expect(text.get('cafe0001')).toBe(2);
    expect(text.get('food0001')).toBe(1);
    expect(text.get('unlabeled')).toBe(0);
  });
});

describe('regionCounts', () => {
  it('sorts by count desc, then name, with 기타 last', () => {
    const at = (address: string) => place({ address });
    // 주소를 해석할 수 없는 장소는 10km 안의 이웃에게서 지역을 빌리므로, 멀리 떨어뜨려 둔다.
    const far = () => place({ address: 'Seoul', lng: 126.5, lat: 33.5 });
    const lib = library([
      far(),
      far(),
      far(),
      at('강원도 양양군 A'),
      at('강원도 속초시 B'),
      at('강원특별자치도 강릉시 C'),
      at('강원특별자치도 강릉시 D'),
    ]);
    expect(regionCounts(lib, q())).toEqual([
      { region: '강릉', count: 2 },
      { region: '속초', count: 1 },
      { region: '양양', count: 1 },
      { region: '기타', count: 3 },
    ]);
  });

  it('applies text and label filters but not the region filter', () => {
    const lib = library(
      [
        place({ address: '강원특별자치도 강릉시 A', labels: ['food0001'] }),
        place({ address: '강원도 양양군 B', labels: ['food0001'] }),
        place({ address: '강원도 양양군 C', labels: ['cafe0001'] }),
      ],
      [FOOD, CAFE],
    );
    expect(regionCounts(lib, q({ labelIds: ['food0001'], regions: ['강릉'] }))).toEqual([
      { region: '강릉', count: 1 },
      { region: '양양', count: 1 },
    ]);
  });
});

describe('inferred regions', () => {
  const JEJU = '제주특별자치도 제주시 연동 1';
  const lib = () =>
    library([
      place({ name: '주소있음', address: JEJU, lng: 126.53, lat: 33.5 }),
      place({ name: '주소없음', address: '', lng: 126.54, lat: 33.51 }),
      place({ name: '멀리', address: '', lng: 128.9, lat: 37.7 }),
    ]);

  it('region filter matches a place by the region borrowed from its neighbor', () => {
    expect(names(queryPlaces(lib(), q({ regions: ['제주'], sort: 'name' })))).toEqual([
      '주소없음',
      '주소있음',
    ]);
    expect(names(queryPlaces(lib(), q({ regions: ['기타'] })))).toEqual(['멀리']);
  });

  it('regionCounts counts the inferred region', () => {
    expect(regionCounts(lib(), q())).toEqual([
      { region: '제주', count: 2 },
      { region: '기타', count: 1 },
    ]);
  });
});

describe('searchPlaces', () => {
  const lib = (places: Place[]): Library => ({
    ...emptyLibrary(),
    places: Object.fromEntries(places.map((p) => [p.id, p])),
  });

  it('이름·주소로 찾고, 숨긴(saved:false) 장소는 넣고 지운 장소는 뺀다', () => {
    const a = place({ name: '다 카페', address: '서울 강남구 테헤란로 1' });
    const b = place({ name: '가 숙소', saved: f(false) });
    const c = place({ name: '나 지운 곳', deletedAt: T });
    const library = lib([a, b, c]);
    expect(searchPlaces(library, '').map((p) => p.name.value)).toEqual(['가 숙소', '다 카페']);
    expect(searchPlaces(library, ' 테헤란 ').map((p) => p.id)).toEqual([a.id]);
    expect(searchPlaces(library, '숙소').map((p) => p.id)).toEqual([b.id]);
    expect(searchPlaces(library, '지운')).toEqual([]);
  });
});

describe('방문 필터', () => {
  const lib = library(
    [
      place({ name: 'A', labels: ['food0001'], visitedOn: f('2026-10-10') }),
      place({ name: 'B', labels: ['cafe0001'], visitedOn: f('2026-10-12') }),
      place({ name: 'C', labels: ['food0001'] }),
      // 표시를 지운 곳(값 null)은 안 가 본 곳으로 센다.
      place({ name: 'D', labels: ['cafe0001'], visitedOn: f<string | null>(null) }),
      place({ name: 'E', address: '강원도 양양군 C' }),
    ],
    [FOOD, CAFE],
  );

  it('visited·unvisited가 다녀온 곳과 안 가 본 곳만 남긴다', () => {
    expect(names(queryPlaces(lib, q({ visited: 'visited', sort: 'name' })))).toEqual(['A', 'B']);
    expect(names(queryPlaces(lib, q({ visited: 'unvisited', sort: 'name' })))).toEqual([
      'C',
      'D',
      'E',
    ]);
    expect(queryPlaces(lib, q({ visited: 'all' }))).toHaveLength(5);
  });

  it('라벨 필터와 겹치면 교집합이다', () => {
    const r = queryPlaces(lib, q({ visited: 'visited', labelIds: ['food0001'] }));
    expect(names(r)).toEqual(['A']);
  });

  it('visitCounts는 라벨 필터를 따르고 방문 필터는 무시한다', () => {
    expect(visitCounts(lib, q())).toEqual({ visited: 2, unvisited: 3 });
    expect(visitCounts(lib, q({ visited: 'visited' }))).toEqual({ visited: 2, unvisited: 3 });
    expect(visitCounts(lib, q({ labelIds: ['food0001'] }))).toEqual({ visited: 1, unvisited: 1 });
    expect(visitCounts(lib, q({ regions: ['양양'] }))).toEqual({ visited: 0, unvisited: 1 });
    expect(visitCounts(lib, q({ text: 'A' }))).toEqual({ visited: 1, unvisited: 0 });
  });

  it('labelCounts·regionCounts가 방문 필터를 따른다', () => {
    const counts = labelCounts(lib, q({ visited: 'visited' }));
    expect(counts.get('food0001')).toBe(1);
    expect(counts.get('cafe0001')).toBe(1);
    expect(counts.get('unlabeled')).toBe(0);
    expect(labelCounts(lib, q({ visited: 'unvisited' })).get('unlabeled')).toBe(1);
    expect(regionCounts(lib, q({ visited: 'unvisited' }))).toEqual([
      { region: '강릉', count: 2 },
      { region: '양양', count: 1 },
    ]);
    expect(regionCounts(lib, q({ visited: 'visited' }))).toEqual([{ region: '강릉', count: 2 }]);
  });

  it('한 줄 평도 검색 대상이다', () => {
    const l = library([
      place({ name: '경포대', review: f('일출 최고') }),
      place({ name: '다른 곳' }),
    ]);
    expect(names(queryPlaces(l, q({ text: '일출' })))).toEqual(['경포대']);
  });
});

describe('sortByVisited', () => {
  it('다녀온 날 내림차순, 안 가 본 곳은 뒤에 최근 저장순이고 입력은 그대로다', () => {
    const early = place({ name: '10-10', visitedOn: f('2026-10-10') });
    const late = place({ name: '10-12', visitedOn: f('2026-10-12') });
    const oldUnvisited = place({ name: '옛 저장', saved: f(true, '2026-10-01T00:00:00.000Z') });
    const newUnvisited = place({ name: '새 저장', saved: f(true, '2026-10-09T00:00:00.000Z') });
    const cleared = place({
      name: '지움',
      visitedOn: f<string | null>(null),
      saved: f(true, '2026-10-05T00:00:00.000Z'),
    });
    const input = [oldUnvisited, early, newUnvisited, cleared, late];
    const before = [...input];
    expect(names(sortByVisited(input))).toEqual(['10-12', '10-10', '새 저장', '지움', '옛 저장']);
    expect(input).toEqual(before);
  });

  it('같은 날은 최근 저장순이다', () => {
    const a = place({
      name: 'a',
      visitedOn: f('2026-10-10'),
      saved: f(true, '2026-10-01T00:00:00.000Z'),
    });
    const b = place({
      name: 'b',
      visitedOn: f('2026-10-10'),
      saved: f(true, '2026-10-02T00:00:00.000Z'),
    });
    expect(names(sortByVisited([a, b]))).toEqual(['b', 'a']);
  });
});

describe('hasVisited', () => {
  it('빈 보관함은 false', () => {
    expect(hasVisited(library([]))).toBe(false);
  });

  it('다녀온 곳이 있으면 true, 표시를 지운 곳만 있으면 false', () => {
    expect(hasVisited(library([place({ visitedOn: f('2026-10-10') })]))).toBe(true);
    expect(hasVisited(library([place({ visitedOn: f<string | null>(null) })]))).toBe(false);
  });

  it('보관함에서 숨긴(saved: false) 곳이나 지운 곳만 다녀왔으면 false', () => {
    const hidden = place({ visitedOn: f('2026-10-10'), saved: f(false) });
    const gone = place({ visitedOn: f('2026-10-10'), deletedAt: T });
    expect(hasVisited(library([hidden, gone]))).toBe(false);
  });
});
