import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { createAppTheme, cssVarsOf } from 'src/theme/create-app-theme';
import { loadDisplayFont } from 'src/theme/fonts';
import { TOKENS } from 'src/theme/tokens';
import { useResolvedTheme } from 'src/theme/use-theme';

/**
 * 저장된 테마·모드(`PrefsStore`)로 MUI 테마와 `<html>`의 `data-theme`·`data-mode`·`--tm-*` 변수를
 * 정한다. 선호가 바뀌면(`prefsAtom`) 새로고침 없이 바뀐다. 저장된 값은 첫 렌더 전에 읽으므로(`prefsAtom`) 기본 테마가 먼저 보이지 않는다.
 */
export function ThemeRoot({ children }: { children: ReactNode }) {
  const { name, mode } = useResolvedTheme();

  const muiTheme = useMemo(() => createAppTheme(name, mode), [name, mode]);
  const vars = useMemo(() => cssVarsOf(TOKENS[name][mode]), [name, mode]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = name;
    root.dataset.mode = mode;
    // 브라우저 기본 위젯(스크롤바·폼)이 모드를 따르게 한다.
    root.style.colorScheme = mode;
    for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
    return () => {
      delete root.dataset.theme;
      delete root.dataset.mode;
      root.style.removeProperty('color-scheme');
      for (const key of Object.keys(vars)) root.style.removeProperty(key);
    };
  }, [name, mode, vars]);

  useEffect(() => {
    if (name !== 'paper') return;
    // 제목 글꼴은 꾸밈이라, 못 받아도 명조 대체 글꼴로 계속 쓴다.
    loadDisplayFont().catch((error: unknown) => {
      console.warn('고운바탕 글꼴을 불러오지 못했어요', error);
    });
  }, [name]);

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
