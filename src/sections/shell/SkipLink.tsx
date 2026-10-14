import Box from '@mui/material/Box';
import { visuallyHidden } from '@mui/utils';

/** 셸의 본문 자리(`<main id="main" tabIndex={-1}>`, `AppShell`). */
export const MAIN_ID = 'main';

/**
 * 본문 바로가기(스펙 §2). 셸 맨 앞에 두어 첫 Tab에 닿는다. 평소에는 보이지 않고, 포커스를 받으면 왼쪽 위에
 * 고정되어 보인다. 누르면 주소의 `#main`을 바꾸지 않고(라우터 기록에 남지 않게) 본문으로 포커스만 옮긴다.
 */
export function SkipLink() {
  return (
    <Box
      component="a"
      href={`#${MAIN_ID}`}
      onClick={(event) => {
        event.preventDefault();
        document.getElementById(MAIN_ID)?.focus();
      }}
      sx={{
        ...visuallyHidden,
        '&:focus': {
          position: 'fixed',
          zIndex: 2000,
          top: 'calc(8px + env(safe-area-inset-top, 0px))',
          left: 'calc(8px + env(safe-area-inset-left, 0px))',
          width: 'auto',
          height: 'auto',
          minHeight: 44,
          m: 0,
          px: 2,
          display: 'flex',
          alignItems: 'center',
          overflow: 'visible',
          clip: 'auto',
          whiteSpace: 'nowrap',
          borderRadius: 'var(--tm-radius-md)',
          bgcolor: 'var(--tm-bg-raised)',
          color: 'var(--tm-text-primary)',
          boxShadow: 'var(--tm-shadow-2)',
          fontWeight: 700,
          textDecoration: 'none',
        },
      }}
    >
      본문으로 바로 가기
    </Box>
  );
}
