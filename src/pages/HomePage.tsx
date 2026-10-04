import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

/** 여행 목록을 노출하지 않는다(§4.1). */
export function HomePage() {
  return (
    <Box
      sx={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <Typography component="p">공유받은 링크로 접속하세요</Typography>
    </Box>
  );
}
