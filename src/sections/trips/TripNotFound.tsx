import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { Link } from 'react-router';
import { paths } from 'src/routes/paths';

/** 없거나 지운 여행을 열었을 때(계획 화면·당일 모드가 함께 쓴다). */
export function TripNotFound() {
  return (
    <Box
      role="alert"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1.5,
        px: 3,
        py: 6,
        textAlign: 'center',
      }}
    >
      <Box component="h1" sx={{ m: 0, fontSize: 'inherit', fontWeight: 800 }}>
        여행을 찾지 못했어요
      </Box>
      <Button component={Link} to={paths.trips} variant="contained" sx={{ minHeight: 44 }}>
        여행 목록으로
      </Button>
    </Box>
  );
}
