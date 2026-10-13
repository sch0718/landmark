import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import { useAtom, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { XIcon } from 'src/components/icons';
import { paths } from 'src/routes/paths';
import { CandidateCard } from 'src/sections/add-place/CandidateCard';
import { FolderPreview } from 'src/sections/add-place/FolderPreview';
import { LinkInputPanel } from 'src/sections/add-place/LinkInputPanel';
import { PinCard } from 'src/sections/add-place/PinCard';
import { ADD_LABEL } from 'src/sections/shell/nav-items';
import { DETAIL_WIDTH } from 'src/sections/shell/pane-widths';
import { useLayout } from 'src/sections/shell/use-layout';
import { addFlowAtom, addTargetAtom, showsAddPanel, type AddFlow } from 'src/stores/add-place';

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
function StepContent({ flow }: { flow: AddFlow }) {
  switch (flow.step) {
    case 'link':
      return <LinkInputPanel hint={flow.hint} />;
    case 'candidate':
      return <CandidateCard candidate={flow.candidate} />;
    case 'folder':
      return <FolderPreview shareId={flow.shareId} />;
    case 'pin-card':
      return <PinCard name={flow.name} lng={flow.lng} lat={flow.lat} />;
    default:
      return null;
  }
}

/**
 * 지도가 있어야 하는 단계에서 지도가 안 보이면 지도가 보이는 경로로 옮긴다. 셸(`AppShell`)이 부른다.
 * - 핀 모드(`pin`)와 확인 카드·핀 카드(`candidate`·`pin-card`, 고른 위치를 지도에 보이려고 — 스펙 §2.2.2)는
 *   지도가 필요하다.
 *   좁은 화면은 지도 탭(`/map`)으로, 그 밖은 지도가 있는 보관함(`/`)으로 간다(예: 넓은 화면의 `/labels`).
 * - 핀 모드 중에 경로가 바뀌면(뒤로 가기·목록에서 장소 고르기·다른 메뉴) 지도가 계속 보여도 핀 모드를
 *   끝낸다(스펙 §2.4). 이 훅이 지도로 옮긴 이동은 예외다.
 * 흐름이 끝나면(`closed`가 되면, 어느 길로든) 붙여 둔 여행 대상(`addTargetAtom`)을 버린다.
 * `mapShown`은 지금 경로·폭에서 지도가 가려지지 않고 보이는가다.
 */
export function useAddFlowRoute(mapShown: boolean) {
  const [flow, setFlow] = useAtom(addFlowAtom);
  const setTarget = useSetAtom(addTargetAtom);
  const layout = useLayout();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const compact = layout === 'compact';
  const step = flow.step;
  const needsMap = step === 'pin' || step === 'candidate' || step === 'pin-card';
  const prev = useRef({ step, pathname });
  // 이 훅이 지도로 옮기는 중이다. 그 경로 변경으로는 핀 모드를 끝내지 않는다.
  const movingToMap = useRef(false);
  useEffect(() => {
    const before = prev.current;
    prev.current = { step, pathname };
    if (before.step !== step) movingToMap.current = false;
    // 흐름이 막 끝났다. 대상을 열어 두기만 한 시트(아직 `closed`)는 시트가 닫힐 때 따로 버린다.
    if (before.step !== 'closed' && step === 'closed') setTarget(null);
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
  }, [step, pathname, needsMap, mapShown, compact, navigate, setFlow, setTarget]);
}

/**
 * 추가 흐름의 자리(스펙 §2.1). 좁은 화면은 아래에서 올라오는 시트, 그 밖은 오른쪽 칸(`DETAIL_WIDTH`)이다.
 * 오른쪽 칸은 셸이 상세 칸 자리에 놓는다(상세가 열려 있어도 추가 흐름이 우선). `floating`이면 지도 위에
 * 덮는 패널(중간 폭·보관함 밖 화면), 아니면 넓은 화면의 오른쪽 칸 그대로다.
 * 단계가 바뀌면 `key`로 내용을 새로 만들어 이전 단계의 입력·진행 중 요청을 이어받지 않는다.
 */
export function AddPlaceHost({ floating = false }: { floating?: boolean }) {
  const [flow, setFlow] = useAtom(addFlowAtom);
  const layout = useLayout();
  const open = showsAddPanel(flow);
  const close = () => setFlow({ step: 'closed' });

  if (layout === 'compact') {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={close}
        slotProps={{
          paper: {
            'aria-label': ADD_LABEL,
            sx: {
              maxWidth: 480,
              width: '100%',
              maxHeight: '90vh',
              // 폴더 미리보기는 긴 목록이라 늘 90vh로 열어 목록 칸이 흔들리지 않게 한다.
              ...(flow.step === 'folder' ? { height: '90vh' } : {}),
              mx: 'auto',
              borderRadius: 'var(--tm-radius-xl) var(--tm-radius-xl) 0 0',
              bgcolor: 'var(--tm-bg-surface)',
              backgroundImage: 'none',
              pb: 'env(safe-area-inset-bottom, 0px)',
            },
          },
        }}
      >
        {open && <StepContent key={stepKey(flow)} flow={flow} />}
      </Drawer>
    );
  }

  if (!open) return null;
  return (
    <Box
      component="section"
      aria-label={ADD_LABEL}
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
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <StepContent key={stepKey(flow)} flow={flow} />
      </Box>
    </Box>
  );
}
