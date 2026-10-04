type LockCallback = (lock: { name: string; mode: string }) => unknown;

const abortError = () => new DOMException('The request was aborted.', 'AbortError');

/**
 * 다른 탭이 잠금을 쥐고 있는 상황을 흉내 내는 LockManager. `hold()` 뒤의 요청은 `release()`까지
 * 기다린다. Web Locks처럼 `{ signal }`을 받으며, 획득 전에 중단되면 AbortError로 거부하고
 * 콜백을 부르지 않는다.
 */
export function createHeldLocks() {
  let held: Promise<void> = Promise.resolve();
  let release: () => void = () => {};
  const requested: string[] = [];

  const request = (
    name: string,
    optionsOrCallback: { signal?: AbortSignal } | LockCallback,
    maybeCallback?: LockCallback,
  ): Promise<unknown> => {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback!;
    const signal = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback.signal;
    requested.push(name);
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      let aborted = false;
      const onAbort = () => {
        aborted = true;
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      void held.then(() => {
        if (aborted) return;
        signal?.removeEventListener('abort', onAbort);
        Promise.resolve()
          .then(() => callback({ name, mode: 'exclusive' }))
          .then(resolve, reject);
      });
    });
  };

  return {
    locks: { request } as unknown as LockManager,
    requested,
    /** 이후 요청이 `release()`까지 기다리게 한다. */
    hold() {
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    release: () => release(),
  };
}
