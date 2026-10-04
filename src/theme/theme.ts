import { createTheme } from '@mui/material/styles';

const fontFamily = [
  'Pretendard',
  '"Apple SD Gothic Neo"',
  '"Noto Sans KR"',
  '"Malgun Gothic"',
  'system-ui',
  '-apple-system',
  'sans-serif',
].join(',');

export const theme = createTheme({
  palette: {
    primary: { main: '#03a65a' },
  },
  typography: { fontFamily },
});
