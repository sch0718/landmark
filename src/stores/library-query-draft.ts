import { atom } from 'jotai';
import type { LibraryQuery } from 'src/domain/library/query';

/**
 * 보관함 화면이 바로 읽는 메모리상의 조건. 저장은 늦게 하므로(디바운스) 화면은 이 값을 본다.
 * `null`이면 아직 바꾼 적이 없어 저장된 선호(`prefsAtom`)가 기준이다. atom이라서 목록이 잠시
 * 사라졌다 다시 그려져도(좁은 화면에서 지도 탭을 다녀옴) 조건이 유지된다.
 * 선호의 `query`를 통째로 바꾸는 쪽(되살리기)은 이 값도 `null`로 되돌려야 옛 필터가 남지 않는다.
 */
export const queryDraftAtom = atom<LibraryQuery | null>(null);
