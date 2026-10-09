/** `globalThis.localStorage`. 접근만으로 예외가 나는 환경(저장소 차단)에서는 `undefined`. */
export function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
