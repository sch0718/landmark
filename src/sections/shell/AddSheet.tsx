import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import Typography from '@mui/material/Typography';
import { useAtomValue, useSetAtom } from 'jotai';
import type { ComponentType, SVGProps } from 'react';
import { useNavigate } from 'react-router';
import { FolderInputIcon, LinkIcon, MapPinIcon, ShareIcon } from 'src/components/icons';
import { paths } from 'src/routes/paths';
import { ADD_LABEL } from 'src/sections/shell/nav-items';
import { addFlowAtom, addTargetAtom, type AddFlow } from 'src/stores/add-place';

/**
 * 항목은 추가 흐름을 바로 열거나(`flow`), 경로로 보낸다(`to`).
 * `onlyWithoutTarget`인 항목은 여행 대상이 붙은 시트(계획 화면에서 연 시트)에는 보이지 않는다.
 */
type Option = {
  label: string;
  description: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  onlyWithoutTarget?: boolean;
} & ({ flow: AddFlow; to?: never } | { to: string; flow?: never });

const OPTIONS: readonly Option[] = [
  {
    label: '링크 붙여넣기',
    description: '네이버·카카오·구글 지도의 장소 링크',
    Icon: LinkIcon,
    flow: { step: 'link', hint: 'place' },
  },
  {
    label: '지도에서 핀 찍기',
    description: '지도를 움직여 위치를 고르기',
    Icon: MapPinIcon,
    flow: { step: 'pin', name: '', start: null },
  },
  {
    label: '네이버 폴더 가져오기',
    description: '네이버 공유 폴더의 장소를 한꺼번에',
    Icon: FolderInputIcon,
    flow: { step: 'link', hint: 'folder' },
  },
  {
    label: '공유 파일 가져오기',
    description: '받은 Landmark 공유 파일(.html)',
    Icon: ShareIcon,
    to: paths.importShare,
    onlyWithoutTarget: true,
  },
];

/** ＋ 버튼이 여는 추가 시트(스펙 §2.1). 항목을 고르면 추가 흐름을 시작하고 시트를 닫는다. */
export function AddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setFlow = useSetAtom(addFlowAtom);
  const navigate = useNavigate();
  const hasTarget = useAtomValue(addTargetAtom) !== null;
  const options = OPTIONS.filter((option) => !(option.onlyWithoutTarget && hasTarget));
  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          'aria-label': ADD_LABEL,
          sx: {
            maxWidth: 480,
            width: '100%',
            mx: 'auto',
            borderRadius: 'var(--tm-radius-xl) var(--tm-radius-xl) 0 0',
            bgcolor: 'var(--tm-bg-surface)',
            backgroundImage: 'none',
            px: 2,
            pt: 1.5,
            pb: 'calc(16px + env(safe-area-inset-bottom, 0px))',
          },
        },
      }}
    >
      <Box
        aria-hidden="true"
        sx={{
          width: 36,
          height: 4,
          borderRadius: 2,
          bgcolor: 'var(--tm-border)',
          mx: 'auto',
          mb: 1.5,
        }}
      />
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 800, mb: 1 }}>
        {ADD_LABEL}
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {options.map(({ label, description, Icon, flow, to }) => (
          <li key={label}>
            <Box
              component="button"
              type="button"
              onClick={() => {
                if (flow !== undefined) setFlow(flow);
                onClose();
                // 경로 항목은 곧바로 다른 주소로 바뀌는 진입 경로(`/import`)라 방문 기록을 남기지 않는다.
                if (to !== undefined) void navigate(to, { replace: true });
              }}
              sx={{
                width: '100%',
                minHeight: 56,
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 0.5,
                border: 0,
                background: 'transparent',
                textAlign: 'left',
                font: 'inherit',
                color: 'var(--tm-text-primary)',
                cursor: 'pointer',
                borderRadius: 'var(--tm-radius-md)',
                '&:hover': { bgcolor: 'var(--tm-bg-raised)' },
                '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: 2 },
              }}
            >
              <Box
                sx={{
                  flex: 'none',
                  width: 40,
                  height: 40,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 'var(--tm-radius-md)',
                  bgcolor: 'var(--tm-bg-raised)',
                }}
              >
                <Icon aria-hidden="true" width={20} height={20} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography component="span" sx={{ display: 'block', fontWeight: 700 }}>
                  {label}
                </Typography>
                <Typography
                  component="span"
                  variant="body2"
                  sx={{ display: 'block', color: 'var(--tm-text-secondary)' }}
                >
                  {description}
                </Typography>
              </Box>
            </Box>
          </li>
        ))}
      </Box>
    </Drawer>
  );
}
