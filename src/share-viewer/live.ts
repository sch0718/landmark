import { LIVE_POLL_MS, parseLiveDoc, type LiveTripDoc } from '../domain/trip-live/live-doc';
export type LiveFetch =
  | { kind: 'doc'; rev: number; updatedAt: string; doc: LiveTripDoc }
  | { kind: 'unchanged' | 'revoked' | 'ended' | 'busy' | 'failed' };
export async function fetchLive(
  id: string,
  token: string,
  since: number | null,
  fetchFn: typeof fetch = fetch,
): Promise<LiveFetch> {
  try {
    const r = await fetchFn(
      `/api/trip-live/${encodeURIComponent(id)}${since === null ? '' : `?since=${since}`}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'same-origin',
        cache: 'no-store',
      },
    );
    if (r.status === 304) return { kind: 'unchanged' };
    if (r.status === 401) return { kind: 'revoked' };
    if (r.status === 404 || r.status === 410) return { kind: 'ended' };
    if (r.status === 429) return { kind: 'busy' };
    if (!r.ok) return { kind: 'failed' };
    const body: unknown = await r.json();
    if (!body || typeof body !== 'object') return { kind: 'failed' };
    const x = body as Record<string, unknown>,
      doc = parseLiveDoc(x.doc);
    if (
      !doc ||
      typeof x.rev !== 'number' ||
      !Number.isSafeInteger(x.rev) ||
      x.rev < 1 ||
      typeof x.updatedAt !== 'string' ||
      typeof x.expiresAt !== 'string'
    )
      return { kind: 'failed' };
    return { kind: 'doc', rev: x.rev, updatedAt: x.updatedAt, doc };
  } catch {
    return { kind: 'failed' };
  }
}
export function createLivePoll(opts: {
  tick(): Promise<'ok' | 'error' | 'stop'>;
  win?: Window;
  idleMs?: number;
}): { stop(): void } {
  const win = opts.win ?? window,
    doc = win.document,
    idleMs = opts.idleMs ?? 300000;
  let timer: number | undefined,
    stopped = false,
    running = false,
    errors = 0,
    lastInput = Date.now();
  const available = () => doc.visibilityState === 'visible' && win.navigator.onLine !== false;
  const idle = () => Date.now() - lastInput >= idleMs;
  function clear() {
    if (timer !== undefined) win.clearTimeout(timer);
    timer = undefined;
  }
  function schedule() {
    clear();
    if (!stopped && available())
      timer = win.setTimeout(
        () => void tick(),
        Math.max(idle() ? 60000 : LIVE_POLL_MS, errors === 0 ? 0 : errors === 1 ? 30000 : 60000),
      );
  }
  async function tick() {
    clear();
    if (stopped || running || !available()) return;
    running = true;
    try {
      const result = await opts.tick();
      if (result === 'stop') {
        stop();
        return;
      }
      errors = result === 'error' ? errors + 1 : 0;
    } catch {
      errors += 1;
    } finally {
      running = false;
      schedule();
    }
  }
  function wake() {
    clear();
    if (available()) void tick();
  }
  function input() {
    const wasIdle = idle();
    lastInput = Date.now();
    if (wasIdle) wake();
  }
  const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
  function stop() {
    stopped = true;
    clear();
    doc.removeEventListener('visibilitychange', wake);
    win.removeEventListener('online', wake);
    win.removeEventListener('offline', wake);
    for (const event of events) win.removeEventListener(event, input, true);
  }
  doc.addEventListener('visibilitychange', wake);
  win.addEventListener('online', wake);
  win.addEventListener('offline', wake);
  for (const event of events) win.addEventListener(event, input, { passive: true, capture: true });
  schedule();
  return { stop };
}
