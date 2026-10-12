import { useCallback } from 'react';
import { toast } from 'sonner';
import type { OpCtx, OpResult } from 'src/domain/library/ops';
import { diffTrip, isEmptyChange, revertTrip, type TripChange } from 'src/domain/trips/undo';
import type { Library } from 'src/schema/library';
import { useLibraryAction, type LibraryActionResult } from 'src/stores/library-state';

/** 되돌리기 토스트를 보이는 시간(스펙 §2.5: 8초). */
export const UNDO_MS = 8000;

/** 되돌리기에서 다른 곳이 바꾼 필드를 건너뛰었을 때(스펙 §6). */
export const MERGED_NOTICE = '다른 곳에서 바뀐 부분은 그대로 두었어요';

export type TripOp = (lib: Library, ctx: OpCtx) => OpResult;

/** 성공한 연산의 결과(`summary.created` 등). */
export type TripOpDone = Extract<LibraryActionResult, { ok: true }>;

/** 토스트 문구. 연산 결과로 정해지면(예: 새로 넣은 수) 함수로 준다. */
export type TripUndoMessage = string | ((result: TripOpDone) => string);

/**
 * 여행 연산을 실행하고 `되돌리기` 토스트를 띄운다(스펙 §2.5). 넣기·빼기·옮기기·순서 정리·자동 나누기·기간 변경이 쓴다.
 *
 * 연산 전후의 여행으로 만든 기록(`diffTrip`)은 저장소 잠금 안, 연산과 같은 최신본에서 만든다. 잠금 밖에서 미리
 * 읽어 둔 화면의 문서로 만들면 그사이 다른 탭이 바꾼 값까지 "이 연산이 바꾼 것"으로 기록될 수 있다.
 * 되돌리기는 그 기록에서 지금도 아무도 바꾸지 않은 필드만 이전 값으로 쓰고, 건너뛴 필드가 있으면 알린다.
 * 연산이 거절됐거나 바뀐 것이 없으면 토스트를 띄우지 않는다. 연산의 결과는 그대로 돌려준다(폼이 거절 사유를 보인다).
 * 문구가 연산 결과에 달렸으면(`<N>곳을 후보에 넣었어요`) `message`를 함수로 준다. 저장된 최신본 기준의 결과를 받는다.
 */
export function useTripUndo(tripId: string): {
  run(op: TripOp, message: TripUndoMessage): Promise<LibraryActionResult>;
} {
  const { run: runAction } = useLibraryAction();

  const undo = useCallback(
    async (change: TripChange) => {
      const result = await runAction((lib, ctx) => revertTrip(lib, change, ctx));
      if (result.ok && (result.summary?.merged ?? 0) > 0) toast(MERGED_NOTICE);
    },
    [runAction],
  );

  const run = useCallback(
    async (op: TripOp, message: TripUndoMessage): Promise<LibraryActionResult> => {
      // 잠금 안의 콜백이 채운다(콜백 밖 변수 대입은 타입 좁히기가 따라가지 못해 상자에 담는다).
      const box: { change: TripChange | null } = { change: null };
      const result = await runAction((lib, ctx) => {
        // 저장소가 다시 시도하며 여러 번 부를 수 있으니 매번 새로 만든다.
        box.change = null;
        const before = lib.trips[tripId];
        const out = op(lib, ctx);
        const after = out.ok ? out.lib.trips[tripId] : undefined;
        if (before !== undefined && after !== undefined) box.change = diffTrip(before, after);
        return out;
      });
      const recorded = box.change;
      if (!result.ok || recorded === null || isEmptyChange(recorded)) return result;
      toast(typeof message === 'string' ? message : message(result), {
        duration: UNDO_MS,
        action: { label: '되돌리기', onClick: () => void undo(recorded) },
      });
      return result;
    },
    [runAction, tripId, undo],
  );

  return { run };
}
