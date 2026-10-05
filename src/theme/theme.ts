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
  shape: { borderRadius: 12 },
  typography: {
    fontFamily,
    body1: { fontSize: 16 },
    body2: { fontSize: 14 },
    caption: { fontSize: 12 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiIconButton: {
      styleOverrides: { root: { minWidth: 44, minHeight: 44 } },
    },
    MuiInputBase: {
      styleOverrides: { input: { fontSize: 16 } },
    },
  },
});
