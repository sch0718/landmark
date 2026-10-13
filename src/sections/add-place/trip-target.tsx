import Box from '@mui/material/Box';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { OpCtx, OpResult } from 'src/domain/library/ops';
import { addCandidates } from 'src/domain/trips/ops';
import { paths } from 'src/routes/paths';
import { candidatesNotice } from 'src/sections/trips/candidate-notice';
import { addFlowAtom, addTargetAtom } from 'src/stores/add-place';
import { libraryAtom } from 'src/stores/library-state';

// 추가 흐름에 여행 대상이 붙었을 때(계획 화면의 `링크·핀으로 새로 추가`, 스펙 §2.2의 4) 카드들이 같이 쓰는 것.

type Done = Extract<OpResult, { ok: true }>;

/**
 * 장소를 넣은 결과 `out`에 이어, 같은 연산 안에서 그 장소들(`placeIds`가 성공한 결과에서 고른다)을 여행 후보에 더한다.
 * 이미 그 여행에 있는 장소는 건너뛰고, `summary.created`는 새로 넣은 수다.
 * 여행이 그사이 지워졌으면 장소만 넣는다. 그때 결과에는 `summary`가 없다.
 */
export function thenAddCandidates(
  out: OpResult,
  tripId: string,
  placeIds: (done: Done) => string[],
  ctx: OpCtx,
): OpResult {
  if (!out.ok) return out;
  const createdId = out.createdId === undefined ? {} : { createdId: out.createdId };
  const next = addCandidates(out.lib, tripId, placeIds(out), ctx);
  return next.ok ? { ...next, ...createdId } : { ok: true, lib: out.lib, ...createdId };
}

/**
 * 지금 흐름의 여행 대상과, 후보에 넣은 뒤의 마무리.
 * - `notify`: 넣은 결과를 알린다(`<N>곳을 후보에 넣었어요` / `이미 Day <N>에 있어요` / `이미 후보에 있어요`).
 * - `backToTrip`: 흐름을 닫고 계획 화면으로 돌아간다. 칸이 닫힌 뒤라면 부르지 않는다(새 흐름을 닫을 수 있다).
 */
export function useTripTarget() {
  const target = useAtomValue(addTargetAtom);
  const setFlow = useSetAtom(addFlowAtom);
  const jotaiStore = useStore();
  const navigate = useNavigate();
  return {
    tripId: target?.tripId ?? null,
    notify(tripId: string, created: number, placeIds: string[]) {
      const trip = jotaiStore.get(libraryAtom).trips[tripId];
      toast(candidatesNotice(created, trip, placeIds));
    },
    backToTrip(tripId: string) {
      setFlow({ step: 'closed' });
      void navigate(paths.trip(tripId));
    },
  };
}

/** 카드의 `보관함에도 저장` 선택(기본 켬). 끄면 보관함 목록에서 숨긴 장소(`saved: false`)로 만든다. */
export function SaveToLibraryOption({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <Box
      component="label"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        minHeight: 44,
        mt: 2,
        fontSize: 15,
        fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      <Box
        component="input"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        sx={{ flex: 'none', width: 20, height: 20, m: 0 }}
      />
      보관함에도 저장
    </Box>
  );
}
