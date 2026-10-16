import { atom } from 'jotai';

/**
 * `다녀온 날순` 정렬을 켰는가. 저장하지 않는다.
 * `tripmap:prefs`의 `query.sort`는 리터럴 유니온이라 새 값을 더하면 옛 버전이 선호 전체를 기본값으로 되돌린다.
 * 그래서 이 정렬은 저장되는 정렬과 별개로 메모리에만 두고, 새로 열면 꺼진 채 시작한다.
 */
export const visitedSortAtom = atom(false);
