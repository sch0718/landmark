import { atom, type PrimitiveAtom } from 'jotai';
import type { PlaceCandidate } from 'src/domain/library/add-place';
import type { ShareDoc } from 'src/schema/share';

/**
 * 장소 추가 흐름(스펙 §2). ＋추가 시트에서 항목을 고르면 시작하고, 추가·취소하면 `closed`로 돌아간다.
 * - `link`: 링크 입력 창. `hint`는 안내 문구만 바꾼다(장소/폴더 판별은 서버 결과로 한다).
 * - `candidate`: 링크로 찾은 장소의 확인 카드.
 * - `folder`: 네이버 공유 폴더 미리보기. `seq`는 `openFolderSyncAtom`이 열 때마다 새로 매기는 번호다
 *   (같은 폴더를 다시 열어도 화면을 새로 만들어 다시 읽게 한다). 링크로 연 폴더에는 없다.
 * - `pin`: 지도에서 위치를 고르는 핀 모드. `name`은 미리 채울 이름, `start`는 시작 좌표(경도, 위도).
 *   `start`는 스펙 §2.4.4(대략적인 위치를 아는 실패 경로)를 위해 남겨 둔 값이라 아직 채우는 호출이 없다.
 * - `pin-card`: 핀으로 고른 위치의 입력 카드.
 * - `share-pick`: 받은 공유 파일 고르기(`/import`).
 * - `share`: 읽은 공유 문서의 미리보기.
 */
export type AddFlow =
  | { step: 'closed' }
  | { step: 'link'; hint: 'place' | 'folder' }
  | { step: 'candidate'; candidate: PlaceCandidate }
  | { step: 'folder'; shareId: string; seq?: number }
  | { step: 'pin'; name: string; start: [number, number] | null }
  | { step: 'pin-card'; name: string; lng: number; lat: number }
  | { step: 'share-pick' }
  | { step: 'share'; doc: ShareDoc };

export const addFlowAtom: PrimitiveAtom<AddFlow> = atom<AddFlow>({ step: 'closed' });

/** 단계마다(링크 창은 안내 종류, 폴더는 공유 ID와 다시 가져오기 번호까지) 내용을 새로 만들 키. */
export const addFlowStepKey = (flow: AddFlow): string => {
  switch (flow.step) {
    case 'link':
      return `link-${flow.hint}`;
    case 'folder':
      return flow.seq === undefined
        ? `folder-${flow.shareId}`
        : `folder-${flow.shareId}-${flow.seq}`;
    case 'pin-card':
      return `pin-card-${flow.lng},${flow.lat}`;
    default:
      return flow.step;
  }
};

let folderSyncSeq = 0;

/**
 * 링크 입력 창에 쓰던 글. 창 폭이 768px 경계를 넘으면 추가 칸이 다시 그려지므로(시트 ↔ 오른쪽 칸) 글을
 * 컴포넌트 밖에 둔다. 흐름이 `link` 단계를 떠나면 `AddPlaceHost`(`useAddFlowRoute`)가 비운다.
 */
export const linkDraftAtom: PrimitiveAtom<string> = atom('');

/**
 * 추가 흐름이 넣을 여행(스펙 §2.2의 4). 계획 화면의 `링크·핀으로 새로 추가`가 정한다.
 * 있으면 카드에 `보관함에도 저장`이 생기고, 추가가 끝나면 그 여행의 후보에 넣고 계획 화면으로 돌아온다.
 * 흐름이 `closed`가 되면(추가·취소·Esc·뒤로 가기 무엇이든) `useAddFlowRoute`가 `null`로 되돌린다.
 */
export const addTargetAtom: PrimitiveAtom<{ tripId: string } | null> = atom<{
  tripId: string;
} | null>(null);

/** ＋추가 시트(`AddSheet`)가 열려 있는가. 셸 밖(계획 화면)에서도 열 수 있게 atom에 둔다. */
export const addSheetOpenAtom: PrimitiveAtom<boolean> = atom(false);

/**
 * 추가 흐름을 연 요소(레일·하단 탭의 ＋). 넓은·중간 화면의 칸을 `Esc`로 닫으면 여기로 포커스를 돌려준다
 * (없거나 화면에서 빠졌으면 본문으로 — `AddPlaceHost`).
 */
export const addOpenerAtom: PrimitiveAtom<HTMLElement | null> = atom<HTMLElement | null>(null);

/**
 * ＋추가 시트를 연다. `target`이 있으면 이번 흐름이 그 여행에 후보를 더하고, 없으면 보통의 추가다.
 * `opener`는 시트를 연 요소다(흐름을 닫을 때 포커스를 돌려줄 곳). 넘기지 않으면 지난 값을 버린다.
 */
export const openAddSheetAtom = atom(
  null,
  (_get, set, target: { tripId: string } | null, opener: HTMLElement | null = null) => {
    set(addTargetAtom, target);
    set(addOpenerAtom, opener);
    set(addSheetOpenAtom, true);
  },
);

/**
 * 연결된 네이버 폴더의 다시 가져오기를 추가 칸에 연다(라벨 관리의 라벨 고치기, 스펙 §4.1). 여행 대상은 버린다
 * (대상이 있으면 다시 가져오기가 아니라 폴더 전체 미리보기가 된다). `opener`는 칸을 닫을 때 포커스를 돌려줄
 * 곳이다(그 라벨 줄).
 */
export const openFolderSyncAtom = atom(
  null,
  (_get, set, shareId: string, opener: HTMLElement | null) => {
    set(addTargetAtom, null);
    set(addOpenerAtom, opener);
    set(addFlowAtom, { step: 'folder', shareId, seq: ++folderSyncSeq });
  },
);

/**
 * 시트를 닫는다. `chosen`은 항목을 골라서 닫는가다. 항목을 고르지 않고 닫았다면(배경·Esc, 흐름이 아직
 * `closed`) 붙여 둔 여행 대상과 연 요소도 버린다(연 요소를 남기면 나중에 ＋ 없이 열린 흐름을 Esc로 닫을 때
 * 엉뚱하게 그 ＋로 돌아간다). 항목을 골랐으면 둘 다 남긴다. 경로 항목(`공유 파일 가져오기`)은 이 순간
 * 흐름이 아직 `closed`지만 곧 `/import`가 흐름을 연다.
 */
export const closeAddSheetAtom = atom(null, (get, set, chosen: boolean = false) => {
  set(addSheetOpenAtom, false);
  if (!chosen && get(addFlowAtom).step === 'closed') {
    set(addTargetAtom, null);
    set(addOpenerAtom, null);
  }
});

/**
 * 추가 칸(넓은 화면의 오른쪽 칸·좁은 화면의 아래 시트)을 쓰는 단계인가.
 * 셸은 이 단계 동안 상세 자리에 추가 칸을 놓고, 지도는 그만큼 가려지는 것으로 본다.
 * 핀 모드(`pin`)는 칸을 쓰지 않는 지도 위 오버레이라서 여기에 들지 않는다(지도를 가리지 않는다).
 */
export function showsAddPanel(flow: AddFlow): boolean {
  return (
    flow.step === 'link' ||
    flow.step === 'candidate' ||
    flow.step === 'folder' ||
    flow.step === 'pin-card' ||
    flow.step === 'share-pick' ||
    flow.step === 'share'
  );
}
