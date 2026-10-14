import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { Suspense, useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ChunkErrorBoundary } from 'src/components/ChunkErrorBoundary';
import { ChunkErrorNotice } from 'src/components/ChunkErrorNotice';
import { XIcon } from 'src/components/icons';
import { LoadingNotice } from 'src/components/LoadingNotice';
import {
  CandidateCard,
  FolderPreview,
  LinkInputPanel,
  PinCard,
  SharePickPanel,
  SharePreview,
} from 'src/routes/lazy-routes';
import { paths } from 'src/routes/paths';
import { focusIsLost, focusStepField, StepScopeContext } from 'src/sections/add-place/step-focus';
import { ADD_LABEL } from 'src/sections/shell/nav-items';
import { DETAIL_WIDTH } from 'src/sections/shell/pane-widths';
import { MAIN_ID } from 'src/sections/shell/SkipLink';
import { useLayout } from 'src/sections/shell/use-layout';
import {
  addFlowAtom,
  addOpenerAtom,
  addTargetAtom,
  linkDraftAtom,
  showsAddPanel,
  type AddFlow,
} from 'src/stores/add-place';

/** 단계마다(링크 창은 안내 종류, 폴더는 공유 ID까지) 내용을 새로 만든다. */
const stepKey = (flow: AddFlow): string => {
  switch (flow.step) {
    case 'link':
      return `link-${flow.hint}`;
    case 'folder':
      return `folder-${flow.shareId}`;
    case 'pin-card':
      return `pin-card-${flow.lng},${flow.lat}`;
    default:
      return flow.step;
  }
};

/** 단계별 칸 내용. 핀 모드(`pin`)는 칸이 아니라 지도 위 오버레이다(`PinModeOverlay`). */
function StepView({ flow }: { flow: AddFlow }) {
  switch (flow.step) {
    case 'link':
      return <LinkInputPanel hint={flow.hint} />;
    case 'candidate':
      return <CandidateCard candidate={flow.candidate} />;
    case 'folder':
      return <FolderPreview shareId={flow.shareId} />;
    case 'pin-card':
      return <PinCard name={flow.name} lng={flow.lng} lat={flow.lat} />;
    case 'share-pick':
      return <SharePickPanel />;
    case 'share':
      return <SharePreview doc={flow.doc} />;
    default:
      return null;
  }
}

/**
 * 단계 화면이 그려지면(파일을 기다렸다면 받은 뒤) 그 단계의 첫 입력 요소로 포커스를 옮긴다(스펙 §2,
 * `focusStepField`). 단계 화면과 같은 `Suspense` 안에 두어 단계가 실제로 그려진 뒤에만 돈다.
 */
function StepFocus({ scope }: { scope: RefObject<HTMLElement | null> }) {
  useEffect(() => {
    focusStepField(scope.current);
  }, [scope]);
  return null;
}

/**
 * 단계 화면 파일은 그 단계가 열릴 때 받는다. 받는 동안은 칸 안에 기다림 표시를, 받지 못하면(새 배포 뒤 옛 파일 없음)
 * 칸 안에 새 버전 안내를 보인다. 칸 닫기는 칸 바깥(`AddPlaceHost`)에 있어 그대로 된다.
 * 좁은 화면 시트에는 닫기 버튼이 없고 단계의 `취소`는 파일이 와야 보이므로, 그 두 경우에만(`withCancel`)
 * 단계와 같은 모양의 `취소`를 안내 아래에 둔다.
 * 단계가 바뀌면 호출하는 쪽이 `key`로 이 컴포넌트를 새로 만들어 오류 경계도 풀린다(새 단계의 첫 입력 요소로
 * 포커스도 다시 옮긴다 — `scope`는 단계 화면을 담은 요소).
 */
function StepContent({
  flow,
  scope,
  withCancel = false,
}: {
  flow: AddFlow;
  scope: RefObject<HTMLElement | null>;
  withCancel?: boolean;
}) {
  const setFlow = useSetAtom(addFlowAtom);
  const cancel = withCancel ? (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, px: 2, pb: 2 }}>
      <Button onClick={() => setFlow({ step: 'closed' })} sx={{ minHeight: 44 }}>
        취소
      </Button>
    </Box>
  ) : null;
  return (
    <StepScopeContext value={scope}>
      <ChunkErrorBoundary
        fallback={
          <>
            <ChunkErrorNotice />
            {cancel}
          </>
        }
      >
        <Suspense
          fallback={
            <>
              <LoadingNotice />
              {cancel}
            </>
          }
        >
          <StepView flow={flow} />
          <StepFocus scope={scope} />
        </Suspense>
      </ChunkErrorBoundary>
    </StepScopeContext>
  );
}

/**
 * 지도가 있어야 하는 단계에서 지도가 안 보이면 지도가 보이는 경로로 옮긴다. 셸(`AppShell`)이 부른다.
 * - 핀 모드(`pin`)와 확인 카드·핀 카드(`candidate`·`pin-card`, 고른 위치를 지도에 보이려고 — 스펙 §2.2.2)는
 *   지도가 필요하다.
 *   좁은 화면은 지도 탭(`/map`)으로, 그 밖은 지도가 있는 보관함(`/`)으로 간다(예: 넓은 화면의 `/labels`).
 * - 핀 모드 중에 경로가 바뀌면(뒤로 가기·목록에서 장소 고르기·다른 메뉴) 지도가 계속 보여도 핀 모드를
 *   끝낸다(스펙 §2.4). 이 훅이 지도로 옮긴 이동은 예외다.
 * 흐름이 끝나면(`closed`가 되면, 어느 길로든) 붙여 둔 여행 대상(`addTargetAtom`)과 연 요소(`addOpenerAtom`)를 버린다.
 * `mapShown`은 지금 경로·폭에서 지도가 가려지지 않고 보이는가다.
 */
export function useAddFlowRoute(mapShown: boolean) {
  const [flow, setFlow] = useAtom(addFlowAtom);
  const setTarget = useSetAtom(addTargetAtom);
  const setOpener = useSetAtom(addOpenerAtom);
  const setLinkDraft = useSetAtom(linkDraftAtom);
  const layout = useLayout();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const compact = layout === 'compact';
  const step = flow.step;
  const needsMap = step === 'pin' || step === 'candidate' || step === 'pin-card';
  const hint = flow.step === 'link' ? flow.hint : null;
  const prev = useRef({ step, pathname, hint });
  // 이 훅이 지도로 옮기는 중이다. 그 경로 변경으로는 핀 모드를 끝내지 않는다.
  const movingToMap = useRef(false);
  useEffect(() => {
    const before = prev.current;
    prev.current = { step, pathname, hint };
    if (before.step !== step) movingToMap.current = false;
    // 흐름이 막 끝났다. 대상을 열어 두기만 한 시트(아직 `closed`)는 시트가 닫힐 때 따로 버린다.
    // 흐름을 연 요소도 잊는다(다음에 ＋ 없이 열린 흐름 — 공유 파일 끌어 놓기 등 — 은 본문으로 돌아가고,
    // 화면에서 빠진 요소를 붙들지 않게).
    if (before.step !== 'closed' && step === 'closed') {
      setTarget(null);
      setOpener(null);
    }
    // 링크 입력 단계를 떠나거나 안내 종류(장소·폴더)가 바뀌었다. 쓰던 글은 이어받지 않는다
    // (폭이 바뀌어도 단계·종류는 그대로라 남는다).
    if (before.step === 'link' && (step !== 'link' || before.hint !== hint)) setLinkDraft('');
    const routeChanged = before.step === step && before.pathname !== pathname;
    if (routeChanged && movingToMap.current) {
      movingToMap.current = false;
    } else if (routeChanged) {
      // 같은 단계에서 경로만 바뀌었다(사용자가 다른 곳으로 갔다).
      if (step === 'pin') setFlow({ step: 'closed' });
      return;
    }
    if (!needsMap || mapShown) return;
    // 단계에 막 들어왔거나(폭이 바뀌어) 지도가 안 보이게 됐다.
    movingToMap.current = true;
    void navigate(compact ? paths.map : paths.library);
  }, [
    step,
    hint,
    pathname,
    needsMap,
    mapShown,
    compact,
    navigate,
    setFlow,
    setTarget,
    setOpener,
    setLinkDraft,
  ]);
}

/**
 * 추가 흐름의 자리(스펙 §2.1). 좁은 화면은 아래에서 올라오는 시트, 그 밖은 오른쪽 칸(`DETAIL_WIDTH`)이다.
 * 오른쪽 칸은 셸이 상세 칸 자리에 놓는다(상세가 열려 있어도 추가 흐름이 우선). `floating`이면 지도 위에
 * 덮는 패널(중간 폭·보관함 밖 화면), 아니면 넓은 화면의 오른쪽 칸 그대로다.
 * 단계가 바뀌면 `key`로 내용을 새로 만들어 이전 단계의 입력·진행 중 요청을 이어받지 않는다.
 * 포커스(스펙 §2): 단계가 열리면 첫 입력 요소로(`StepFocus`). 시트는 대화상자라 `Esc`·포커스 가두기를 MUI가
 * 맡고, 오른쪽 칸은 칸 안에서 누른 `Esc`로 흐름을 닫는다. 어느 길로 닫혀도(`Esc`·닫기·취소·추가 끝) 칸과 함께
 * 포커스가 빠졌으면 흐름을 연 ＋(없거나 화면에서 빠졌으면 본문)로 돌려준다.
 */
export function AddPlaceHost({ floating = false }: { floating?: boolean }) {
  const [flow, setFlow] = useAtom(addFlowAtom);
  const opener = useAtomValue(addOpenerAtom);
  const store = useStore();
  const layout = useLayout();
  const open = showsAddPanel(flow);
  const close = () => setFlow({ step: 'closed' });
  const scope = useRef<HTMLElement>(null);

  // 칸이 닫힐 때(넓은 화면 보관함에서는 이 컴포넌트가 상세 칸으로 바뀌며 빠질 때) 포커스를 돌려준다.
  // 정리 함수가 도는 때는 칸이 이미 빠진 뒤다. 흐름이 아직 열려 있으면(폭이 바뀌어 칸 자리만 옮김) 두고,
  // 포커스가 남아 있으면(시트가 스스로 돌려줬거나 사용자가 다른 곳을 눌렀다) 건드리지 않는다.
  useEffect(() => {
    if (!open) return;
    return () => {
      if (showsAddPanel(store.get(addFlowAtom)) || !focusIsLost()) return;
      const back = opener?.isConnected === true ? opener : document.getElementById(MAIN_ID);
      back?.focus({ preventScroll: true });
    };
  }, [open, opener, store]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // 칸 안의 메뉴·입력칸이 먼저 받은 Esc(전파를 멈췄거나 기본 동작을 막은 것)와 한글 조합 중의 Esc는 그쪽 몫이다.
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return;
    event.preventDefault();
    close();
  };

  if (layout === 'compact') {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={close}
        slotProps={{
          paper: {
            ref: scope,
            'aria-label': ADD_LABEL,
            sx: {
              maxWidth: 480,
              width: '100%',
              maxHeight: '90vh',
              // 폴더·공유 파일 미리보기는 긴 목록이라 늘 90vh로 열어 목록 칸이 흔들리지 않게 한다.
              // 파일 고르기(`share-pick`)도 미리보기로 바뀔 때 시트가 출렁이지 않게 같은 높이다.
              ...(flow.step === 'folder' || flow.step === 'share-pick' || flow.step === 'share'
                ? { height: '90vh' }
                : {}),
              mx: 'auto',
              borderRadius: 'var(--tm-radius-xl) var(--tm-radius-xl) 0 0',
              bgcolor: 'var(--tm-bg-surface)',
              backgroundImage: 'none',
              pb: 'env(safe-area-inset-bottom, 0px)',
            },
          },
        }}
      >
        {open && <StepContent key={stepKey(flow)} flow={flow} scope={scope} withCancel />}
      </Drawer>
    );
  }

  if (!open) return null;
  return (
    <Box
      component="section"
      aria-label={ADD_LABEL}
      onKeyDown={onKeyDown}
      sx={{
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'var(--tm-bg-surface)',
        borderLeft: '1px solid var(--tm-border)',
        ...(floating
          ? {
              position: 'absolute',
              zIndex: 1100,
              top: 0,
              right: 0,
              bottom: 0,
              width: DETAIL_WIDTH,
              maxWidth: '100%',
              boxShadow: 'var(--tm-shadow-2)',
            }
          : { flex: 'none', width: DETAIL_WIDTH }),
      }}
    >
      <Box sx={{ flex: 'none', display: 'flex', justifyContent: 'flex-end', p: 0.5 }}>
        <IconButton onClick={close} aria-label="닫기">
          <XIcon aria-hidden="true" />
        </IconButton>
      </Box>
      <Box ref={scope} sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <StepContent key={stepKey(flow)} flow={flow} scope={scope} />
      </Box>
    </Box>
  );
}
