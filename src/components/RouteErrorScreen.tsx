import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useEffect } from 'react';
import { useRouteError } from 'react-router';
import { isChunkLoadError } from 'src/lib/lazy-chunk';
import { ChunkErrorNotice } from './ChunkErrorNotice';

/** 라우트 렌더 중 예기치 않은 오류가 나면 보여 주는 화면(새로고침 버튼). 나눠 받기 실패면 새 버전 안내를 고른다. */
export function RouteErrorScreen() {
  const error = useRouteError();
  useEffect(() => {
    console.error('화면을 그리지 못했어요', error);
  }, [error]);
  if (isChunkLoadError(error)) return <ChunkErrorNotice fullScreen />;
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
        문제가 생겨 화면을 표시하지 못했어요
      </Typography>
      <Typography variant="body2" color="text.secondary">
        새로고침해도 계속되면 링크를 다시 확인해 주세요.
      </Typography>
      <Button variant="contained" onClick={() => window.location.reload()}>
        새로고침
      </Button>
    </Box>
  );
}
