import { describe, expect, it } from 'vitest';
import { DEFAULT_QUERY, type LibraryQuery } from 'src/domain/library/query';
import { exportTargets } from 'src/sections/share-export/export-targets';
import { L_CAFE, L_FOOD, L_SEA, makeLabel, makePlace } from '../library/fixtures';

const labels = [
  makeLabel(L_FOOD, '맛집', 'red', 'utensils', 0),
  makeLabel(L_CAFE, '카페', 'yellow', 'coffee', 1),
  makeLabel(L_SEA, '바다뷰', 'blue', 'waves', 2),
];
const q = (patch: Partial<LibraryQuery> = {}): LibraryQuery => ({ ...DEFAULT_QUERY, ...patch });
const visible = [makePlace(3), makePlace(1), makePlace(2)];

describe('exportTargets', () => {
  it('uses the selected places in list order', () => {
    const t = exportTargets(visible, ['place00002', 'place00003'], q(), labels);
    expect(t.ids).toEqual(['place00003', 'place00002']);
    expect(t.summary).toBe('선택한 2곳을 내보냅니다');
    expect(t.defaultTitle).toBe('장소 2곳');
  });

  it('silently drops selected ids that are not visible (deleted or filtered out)', () => {
    const t = exportTargets(visible, ['place00001', 'place00099'], q(), labels);
    expect(t.ids).toEqual(['place00001']);
    expect(t.summary).toBe('선택한 1곳을 내보냅니다');

    // 고른 것이 모두 빠지면 0곳(창에서 버튼을 막는다). 보이는 전부로 바꾸지 않는다.
    const none = exportTargets(visible, ['place00099'], q(), labels);
    expect(none.ids).toEqual([]);
    expect(none.summary).toBe('선택한 0곳을 내보냅니다');
  });

  it('without a selection exports everything visible, naming the label filter and search', () => {
    const t = exportTargets([makePlace(2)], [], q({ labelIds: [L_CAFE], text: ' 서 ' }), labels);
    expect(t.ids).toEqual(['place00002']);
    expect(t.summary).toBe('지금 보이는 1곳을 내보냅니다 (라벨: 카페) (검색: 서)');
    expect(t.defaultTitle).toBe('카페');
  });

  it('방문 필터는 라벨 꼬리 뒤·검색 꼬리 앞에 붙는다', () => {
    const visited = exportTargets(
      visible,
      [],
      q({ visited: 'visited', labelIds: [L_CAFE] }),
      labels,
    );
    expect(visited.summary).toBe('지금 보이는 3곳을 내보냅니다 (라벨: 카페) (가 본 곳만)');
    const unvisited = exportTargets(
      visible,
      [],
      q({ visited: 'unvisited', labelIds: [L_CAFE], text: '서' }),
      labels,
    );
    expect(unvisited.summary).toBe(
      '지금 보이는 3곳을 내보냅니다 (라벨: 카페) (안 가 본 곳만) (검색: 서)',
    );
    expect(exportTargets(visible, [], q({ visited: 'all' }), labels).summary).toBe(
      '지금 보이는 3곳을 내보냅니다',
    );
    // 고른 것이 있으면 방문 꼬리는 붙지 않는다.
    expect(exportTargets(visible, ['place00001'], q({ visited: 'visited' }), labels).summary).toBe(
      '선택한 1곳을 내보냅니다',
    );
  });

  it('lists several filter labels in label order and titles by count', () => {
    const t = exportTargets(visible, [], q({ labelIds: [L_SEA, L_FOOD] }), labels);
    expect(t.summary).toBe('지금 보이는 3곳을 내보냅니다 (라벨: 맛집, 바다뷰)');
    expect(t.defaultTitle).toBe('장소 3곳');
  });

  it('ignores filter label ids that are no longer live', () => {
    const t = exportTargets(visible, [], q({ labelIds: [L_CAFE, 'label999'] }), labels);
    expect(t.summary).toBe('지금 보이는 3곳을 내보냅니다 (라벨: 카페)');
    expect(t.defaultTitle).toBe('카페');
  });

  it('names the unlabeled filter but never uses it as the title', () => {
    const t = exportTargets(visible, [], q({ unlabeled: true }), labels);
    expect(t.summary).toBe('지금 보이는 3곳을 내보냅니다 (라벨: 미분류)');
    expect(t.defaultTitle).toBe('장소 3곳');
  });

  it('adds nothing when there is no filter (blank search counts as none)', () => {
    const t = exportTargets(visible, [], q({ text: '   ' }), labels);
    expect(t.ids).toEqual(['place00003', 'place00001', 'place00002']);
    expect(t.summary).toBe('지금 보이는 3곳을 내보냅니다');
    expect(t.defaultTitle).toBe('장소 3곳');
  });
});
