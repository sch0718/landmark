import Box from '@mui/material/Box';

/** 보관함·화면 파일을 기다리는 동안 보여 주는 표시. 셸과 라우트 화면 자리가 같은 모양을 쓴다. */
export function LoadingNotice() {
  return (
    <Box role="status" sx={{ p: 3, color: 'var(--tm-text-secondary)' }}>
      불러오는 중…
    </Box>
  );
}
