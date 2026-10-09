import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import Typography from '@mui/material/Typography';
import type { ComponentType, SVGProps } from 'react';
import { FolderInputIcon, LinkIcon, MapPinIcon } from 'src/components/icons';
import { ADD_LABEL } from 'src/sections/shell/nav-items';

const OPTIONS: readonly { label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { label: '링크 붙여넣기', Icon: LinkIcon },
  { label: '지도에서 핀 찍기', Icon: MapPinIcon },
  { label: '네이버 폴더 가져오기', Icon: FolderInputIcon },
];

/** ＋ 버튼이 여는 추가 시트. 이 단계에서는 세 항목 모두 "곧 제공돼요" 상태로 비활성이다. */
export function AddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
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
        {OPTIONS.map(({ label, Icon }) => (
          <li key={label}>
            <Box
              component="button"
              type="button"
              disabled
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
                color: 'var(--tm-text-muted)',
                cursor: 'not-allowed',
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
                <Typography component="span" variant="body2" sx={{ display: 'block' }}>
                  곧 제공돼요
                </Typography>
              </Box>
            </Box>
          </li>
        ))}
      </Box>
    </Drawer>
  );
}
