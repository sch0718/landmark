import { createStore } from 'jotai';
import { expect, it } from 'vitest';
import {
  cacheKey,
  columnsFromTemplate,
  rowsOf,
  virtualPlaceCacheAtom,
} from 'src/sections/explore/view/virtual-place-state';

it('CSS가 계산한 track을 세고 마지막 행 순서를 보존한다', () => {
  expect(columnsFromTemplate('173px 173px')).toBe(2);
  expect(columnsFromTemplate('280px 280px 280px')).toBe(3);
  expect(columnsFromTemplate('280px 0px 0px')).toBe(1);
  expect(columnsFromTemplate('none')).toBe(1);
  expect(rowsOf(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  expect(rowsOf([], 2)).toEqual([]);
  expect(rowsOf(['a', 'b'], 0)).toEqual([['a'], ['b']]);
});

it('동일 길이 재정렬, 폭, 표시방식은 다른 cache이며 Provider를 격리한다', () => {
  const a = cacheKey('grid', 390, 2, ['a', 'b']);
  expect(cacheKey('grid', 390, 2, ['b', 'a'])).not.toBe(a);
  expect(cacheKey('grid', 389, 2, ['a', 'b'])).not.toBe(a);
  expect(cacheKey('grid', 390, 1, ['a', 'b'])).not.toBe(a);
  expect(cacheKey('list', 390, 1, ['a', 'b'])).not.toBe(a);
  const first = createStore(),
    second = createStore();
  first.set(virtualPlaceCacheAtom, {
    places: { key: a, content: {}, offset: 500, measurements: [] },
  });
  expect(second.get(virtualPlaceCacheAtom)).toEqual({});
});
