import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

/** 나눠 받기가 실패했을 때(새 버전이 배포된 경우) 보여 주는 안내와 새로고침 버튼. 자동 새로고침은 하지 않는다. */
export function ChunkErrorNotice({ fullScreen = false }: { fullScreen?: boolean }) {
  const reload = () => window.location.reload();
  if (fullScreen) {
    return (
      <Box
        role="alert"
        sx={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1.5,
          p: 3,
          textAlign: 'center',
        }}
      >
        <Typography variant="h6" component="h1">
          새 버전이 나왔어요. 새로고침해 주세요
        </Typography>
        <Button variant="contained" onClick={reload}>
          새로고침
        </Button>
      </Box>
    );
  }
  return (
    <Box sx={{ p: 2 }}>
      <Typography role="alert" variant="body2" color="error">
        새 버전이 나왔어요. 새로고침해 주세요
      </Typography>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2 }}>
        <Button variant="outlined" onClick={reload} sx={{ minHeight: 44 }}>
          새로고침
        </Button>
      </Box>
    </Box>
  );
}
