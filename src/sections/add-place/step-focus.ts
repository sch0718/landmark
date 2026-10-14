import { createContext, useContext, useEffect, type RefObject } from 'react';

/** 단계가 열릴 때 포커스할 첫 입력 요소. 숨긴 입력(파일 고르기 등)과 꺼진 요소는 건너뛴다. */
const FIRST_FIELD =
  'input:not([type="hidden"]):not([hidden]):not(:disabled), textarea:not(:disabled), button:not(:disabled)';

/**
 * 추가 칸(`scope`) 안에서 포커스할 요소로 포커스를 옮긴다(스펙 §2). 단계가 `data-autofocus`로 정한 요소가
 * 있으면 그것을, 없으면 첫 입력 요소를 고른다. 칸이 열리며 지도·목록이 스크롤되지 않게 `preventScroll`로 옮긴다.
 */
export function focusStepField(scope: HTMLElement | null): void {
  if (scope === null) return;
  const target =
    scope.querySelector<HTMLElement>('[data-autofocus]') ??
    scope.querySelector<HTMLElement>(FIRST_FIELD);
  target?.focus({ preventScroll: true });
}

/** 단계 화면을 담은 칸 요소. `AddPlaceHost`가 내려 준다. */
export const StepScopeContext = createContext<RefObject<HTMLElement | null> | null>(null);

/** 포커스가 어디에도 없다(포커스된 요소가 화면에서 빠져 `body`로 돌아갔다). */
export function focusIsLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || !active.isConnected;
}

/**
 * 단계 안의 내용이 통째로 바뀔 때(폴더 미리보기가 `찾는 중` → 목록) 포커스된 요소가 사라져 `body`로 빠지면,
 * `ready`가 된 뒤 칸의 첫 입력 요소로 다시 옮긴다. 사용자가 그새 다른 곳으로 포커스를 옮겼으면 그대로 둔다.
 */
export function useStepRefocus(ready: boolean): void {
  const scope = useContext(StepScopeContext);
  useEffect(() => {
    if (!ready || scope === null || !focusIsLost()) return;
    focusStepField(scope.current);
  }, [ready, scope]);
}
