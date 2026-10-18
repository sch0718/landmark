import { atom, type PrimitiveAtom } from 'jotai';

/**
 * 목록에게 "이 장소의 행으로 스크롤하라"고 요청한다(지도 마커를 눌렀을 때).
 * 같은 장소를 다시 눌러도 요청이 새로 읽히도록 `seq`를 매번 올린다. 목록은 처리한 `seq`를 기억한다.
 */
export const focusPlaceAtom: PrimitiveAtom<{ id: string; seq: number } | null> = atom<{
  id: string;
  seq: number;
} | null>(null);

/**
 * 장소를 열기 전에 보던 보관함 화면: `list`(`/`) 또는 `map`(`/map`). 상세를 닫으면 이리로 돌아간다(스펙 A1 §3.1).
 * 셸(`AppShell`)이 장소가 열리지 않은 보관함 경로를 볼 때마다 정한다.
 */
export const detailOriginAtom: PrimitiveAtom<'list' | 'map'> = atom<'list' | 'map'>('list');
