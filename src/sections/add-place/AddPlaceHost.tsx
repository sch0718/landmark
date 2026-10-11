import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import { useAtom } from 'jotai';
import { XIcon } from 'src/components/icons';
import { CandidateCard } from 'src/sections/add-place/CandidateCard';
import { FolderPreview } from 'src/sections/add-place/FolderPreview';
import { LinkInputPanel } from 'src/sections/add-place/LinkInputPanel';
import { ADD_LABEL } from 'src/sections/shell/nav-items';
import { DETAIL_WIDTH } from 'src/sections/shell/pane-widths';
import { useLayout } from 'src/sections/shell/use-layout';
import { addFlowAtom, showsAddPanel, type AddFlow } from 'src/stores/add-place';

/** 단계마다(링크 창은 안내 종류, 폴더는 공유 ID까지) 내용을 새로 만든다. */
const stepKey = (flow: AddFlow): string => {
  switch (flow.step) {
    case 'link':
      return `link-${flow.hint}`;
    case 'folder':
      return `folder-${flow.shareId}`;
    default:
      return flow.step;
  }
};

/** 단계별 칸 내용. 핀 입력 카드는 이후 단계에서 채운다. */
function StepContent({ flow }: { flow: AddFlow }) {
  switch (flow.step) {
    case 'link':
      return <LinkInputPanel hint={flow.hint} />;
    case 'candidate':
      return <CandidateCard candidate={flow.candidate} />;
    case 'folder':
      return <FolderPreview shareId={flow.shareId} />;
    default:
      return null;
  }
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
