import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { visitedOnOf } from 'src/domain/library/visit';
import { markVisit, revertVisit } from 'src/domain/trips/today-visit';
import type { Place } from 'src/schema/library';
import { MERGED_NOTICE, UNDO_MS } from 'src/sections/trips/planner/use-trip-undo';
import { useLibraryAction } from 'src/stores/library-state';

/** Sonner가 토스트를 그리는 자리. */
const TOASTER_SELECTOR = '[data-sonner-toaster]';

/** 누른 `되돌리기` 버튼. 이벤트에 없으면 그 순간 토스트 안에 있던 포커스를 쓴다. */
function pressedButton(event: { currentTarget?: unknown } | undefined): Element | null {
  const target = event?.currentTarget;
  if (target instanceof Element) return target;
  const active = document.activeElement;
  return active?.closest(TOASTER_SELECTOR) ? active : null;
}

type Options = {
  /**
   * 토스트의 `되돌리기`가 끝났다(바꿨든 아니든). 화면이 포커스를 되살릴 때 쓴다. `pressed`는 누른 순간의
   * `되돌리기` 버튼(알 수 없으면 null)이다.
   */
  onUndone?: (pressed: Element | null) => void;
};

/**
 * 당일 모드의 다녀옴 체크·풀기(스펙 §4.4·§5.7). `next`가 참이면 `date`(오늘 Day의 날짜), 거짓이면 `null`을 쓴다.
 *
 * - 바꾸기 전 값은 저장소 잠금 안, 연산과 같은 최신본에서 읽는다(화면의 문서는 다른 탭 변경을 모를 수 있다).
 * - 저장 중인 장소 id는 `pending`에 두고 같은 장소의 체크를 막는다(두 번 눌러도 저장은 한 번).
 * - 바뀐 것이 있으면 `되돌리기` 토스트(8초). 되돌리기는 지금 값이 내가 쓴 값일 때만 이전 값으로 되쓰고,
 *   아니면 아무것도 바꾸지 않고 `MERGED_NOTICE`를 알린다.
 * - 저장 실패는 `useLibraryAction`이 앱 오류 보고자로 알린다. 화면은 저장된 값을 그대로 보인다(낙관 표시 없음).
 *
 * `toggle`은 값을 썼으면(바뀐 것이 없어도) 참, 저장 중이라 무시했거나 실패했으면 거짓으로 끝난다.
 */
export function useVisitToggle(options: Options = {}): {
  toggle(place: Place, next: boolean, date: string): Promise<boolean>;
  pending: ReadonlySet<string>;
} {
  const { run } = useLibraryAction();
  // 토스트는 8초 동안 남으므로 그때의 콜백을 부른다. 콜백이 바뀌어도 `undo`·`toggle`은 그대로다.
  const onUndone = useRef(options.onUndone);
  useEffect(() => {
    onUndone.current = options.onUndone;
  });
  // 렌더를 기다리지 않고 바로 막도록 진행 중인 id는 ref에, `aria-disabled` 표시에 쓰는 사본은 상태에 둔다.
  const saving = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());

  const undo = useCallback(
    async (
      placeId: string,
      written: string | null,
      previous: string | null,
      pressed: Element | null,
    ) => {
      const result = await run(revertVisit(placeId, written, previous));
      if (result.ok && (result.summary?.merged ?? 0) > 0) toast(MERGED_NOTICE);
      onUndone.current?.(pressed);
    },
    [run],
  );

  const toggle = useCallback(
    async (place: Place, next: boolean, date: string): Promise<boolean> => {
      const id = place.id;
      if (saving.current.has(id)) return false;
      saving.current.add(id);
      setPending(new Set(saving.current));
      try {
        const written = next ? date : null;
        // 잠금 안의 콜백이 채운다. 저장소가 다시 시도하며 여러 번 부를 수 있으니 매번 새로 쓴다.
        const box: { previous: string | null; changed: boolean } = {
          previous: null,
          changed: false,
        };
        const result = await run((lib, ctx) => {
          const current = lib.places[id];
          box.previous = current === undefined ? null : visitedOnOf(current);
          const out = markVisit(id, written)(lib, ctx);
          box.changed = out.ok && out.lib !== lib;
          return out;
        });
        if (!result.ok) return false;
        if (box.changed) {
          const name = place.name.value;
          const previous = box.previous;
          toast(next ? `‘${name}’ 다녀옴으로 표시했어요` : `‘${name}’ 다녀옴 표시를 지웠어요`, {
            duration: UNDO_MS,
            action: {
              label: '되돌리기',
              // 누른 버튼은 누른 순간에 잡아 둔다. 저장이 끝날 때 포커스가 토스트 안에 있어도 그것이 이
              // 버튼인지(곧 사라짐) 사람이 옮긴 다른 토스트의 버튼인지는 그때 알 수 없다.
              onClick: (event) => void undo(id, written, previous, pressedButton(event)),
            },
          });
        }
        return true;
      } finally {
        saving.current.delete(id);
        setPending(new Set(saving.current));
      }
    },
    [run, undo],
  );

  return { toggle, pending };
}
