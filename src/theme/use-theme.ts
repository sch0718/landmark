import { useAtomValue } from 'jotai';
import { useSyncExternalStore } from 'react';
import { prefsAtom } from 'src/stores/prefs-state';
import { TOKENS, type ColorMode, type ThemeName, type Tokens } from 'src/theme/tokens';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribeSystemDark(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const systemIsDark = () =>
  typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;

/** 저장된 테마와 모드 선호('system'은 OS 설정)를 풀어 지금 적용되는 테마 이름·모드를 돌려준다. */
export function useResolvedTheme(): { name: ThemeName; mode: ColorMode } {
  const { theme: name, mode: preference } = useAtomValue(prefsAtom);
  const systemDark = useSyncExternalStore(subscribeSystemDark, systemIsDark, () => false);
  const mode: ColorMode = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  return { name, mode };
}

/** 지금 적용되는 테마의 토큰 값. CSS 변수를 쓸 수 없는 곳(지도 마커 색)에서 쓴다. */
export function useThemeTokens(): Tokens {
  const { name, mode } = useResolvedTheme();
  return TOKENS[name][mode];
}
