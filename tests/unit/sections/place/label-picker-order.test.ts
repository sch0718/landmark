import { describe, expect, it } from 'vitest';
import {
  arrangeLabels,
  canCreateLabel,
  filterLabels,
  orderLabelsForPicker,
} from 'src/sections/place/label-picker-order';
import { makeLabel } from '../library/fixtures';

const a = makeLabel('label00a', '서울 맛집', 'red', 'utensils', 0);
const b = makeLabel('label00b', '강원도 명소', 'blue', 'mountain', 1);
const c = makeLabel('label00c', '서울 카페&베이커리', 'yellow', 'coffee', 2);
const d = makeLabel('label00d', 'Bar', 'red', 'beer', 3);
const labels = [a, b, c, d];

describe('orderLabelsForPicker', () => {
  it('붙은 라벨 → 많이 쓴 순 → 원래 순서', () => {
    const counts = new Map([
      ['label00a', 3],
      ['label00b', 40],
      ['label00c', 40],
      ['label00d', 0],
    ]);
    expect(orderLabelsForPicker(labels, ['label00d'], counts)).toEqual([
      'label00d',
      'label00b',
      'label00c',
      'label00a',
    ]);
  });
});

describe('arrangeLabels', () => {
  it('고정한 순서대로 늘어놓고, 순서에 없는(새로 만든) 라벨은 맨 앞', () => {
    const e = makeLabel('label00e', '새 라벨', 'blue', 'star', 4);
    expect(arrangeLabels([...labels, e], ['label00b', 'label00a', 'label00d', 'label00c'])).toEqual(
      [e, b, a, d, c],
    );
  });
});

describe('filterLabels', () => {
  it('이름에 검색어가 든 라벨만, 대소문자·앞뒤 공백 무시', () => {
    expect(filterLabels(labels, ' 서울 ')).toEqual([a, c]);
    expect(filterLabels(labels, 'bar')).toEqual([d]);
    expect(filterLabels(labels, '')).toEqual(labels);
  });
});

describe('canCreateLabel', () => {
  it('비어 있지 않고 같은 이름이 없을 때만', () => {
    expect(canCreateLabel(labels, '국밥')).toBe(true);
    expect(canCreateLabel(labels, '  서울   맛집 ')).toBe(false);
    expect(canCreateLabel(labels, 'BAR')).toBe(false);
    expect(canCreateLabel(labels, '   ')).toBe(false);
  });
});
