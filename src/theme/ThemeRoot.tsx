import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { loadPrefsAtom, prefsAtom } from 'src/stores/prefs-state';
import { createAppTheme, cssVarsOf } from 'src/theme/create-app-theme';
import { loadDisplayFont } from 'src/theme/fonts';
import { TOKENS, type ColorMode } from 'src/theme/tokens';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribeSystemDark(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const systemIsDark = () =>
  typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;

/**
 * 저장된 테마·모드(`PrefsStore`)로 MUI 테마와 `<html>`의 `data-theme`·`data-mode`·`--tm-*` 변수를
 * 정한다. 선호가 바뀌면(`prefsAtom`) 새로고침 없이 바뀐다. 저장된 값을 읽는 동안은 기본값으로 그린다.
 */
export function ThemeRoot({ children }: { children: ReactNode }) {
  const { theme: name, mode: preference } = useAtomValue(prefsAtom);
  const loadPrefs = useSetAtom(loadPrefsAtom);
  useEffect(() => loadPrefs(), [loadPrefs]);

  const systemDark = useSyncExternalStore(subscribeSystemDark, systemIsDark, () => false);
  const mode: ColorMode = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

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
