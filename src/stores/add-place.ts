import { atom, type PrimitiveAtom } from 'jotai';
import type { PlaceCandidate } from 'src/domain/library/add-place';

/**
 * 장소 추가 흐름(스펙 §2). ＋추가 시트에서 항목을 고르면 시작하고, 추가·취소하면 `closed`로 돌아간다.
 * - `link`: 링크 입력 창. `hint`는 안내 문구만 바꾼다(장소/폴더 판별은 서버 결과로 한다).
 * - `candidate`: 링크로 찾은 장소의 확인 카드.
 * - `folder`: 네이버 공유 폴더 미리보기.
 * - `pin`: 지도에서 위치를 고르는 핀 모드. `name`은 미리 채울 이름, `start`는 시작 좌표(경도, 위도).
 * - `pin-card`: 핀으로 고른 위치의 입력 카드.
 */
export type AddFlow =
  | { step: 'closed' }
  | { step: 'link'; hint: 'place' | 'folder' }
  | { step: 'candidate'; candidate: PlaceCandidate }
  | { step: 'folder'; shareId: string }
  | { step: 'pin'; name: string; start: [number, number] | null }
  | { step: 'pin-card'; name: string; lng: number; lat: number };

export const addFlowAtom: PrimitiveAtom<AddFlow> = atom<AddFlow>({ step: 'closed' });

/**
 * 추가 칸(넓은 화면의 오른쪽 칸·좁은 화면의 아래 시트)을 쓰는 단계인가.
 * 셸은 이 단계 동안 상세 자리에 추가 칸을 놓고, 지도는 그만큼 가려지는 것으로 본다.
 */
export function showsAddPanel(flow: AddFlow): boolean {
  return flow.step === 'link' || flow.step === 'candidate' || flow.step === 'folder';
}
