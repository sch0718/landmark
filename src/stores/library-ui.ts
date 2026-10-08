import { atom, type PrimitiveAtom } from 'jotai';

/**
 * 목록에게 "이 장소의 행으로 스크롤하라"고 요청한다(지도 마커를 눌렀을 때).
 * 같은 장소를 다시 눌러도 요청이 새로 읽히도록 `seq`를 매번 올린다. 목록은 처리한 `seq`를 기억한다.
 */
export const focusPlaceAtom: PrimitiveAtom<{ id: string; seq: number } | null> = atom<{
  id: string;
  seq: number;
} | null>(null);
