import { getDefaultStore } from 'jotai';
import { toast } from 'sonner';
import { loadSyncEngine } from 'src/services/library-sync/boot';
import { getSharedSyncStorage } from 'src/services/library-sync/shared-api';
import { readSession, readSyncMeta } from 'src/services/library-sync/storage';
import { agentChangesOpenAtom, agentInboxOpenAtom } from 'src/stores/agent-inbox';
import { syncStatusAtom } from 'src/stores/sync-status';
import { createAgentApi, sameOwner, type AgentApi } from './api';
import { readAgentInboxLocal, writeAgentInboxLocal } from './storage';

export { sameOwner as sameOwnerNow } from './api';
export const INBOX_CHECK_GAP_MS = 10 * 60 * 1000;
export type InboxCheckDeps = {
  api(): AgentApi | null;
  storage: Storage;
  now(): number;
  notify(count: number): void;
  notifyChanges(count: number): void;
  session(): string | null;
  schedule(): void;
  visible?(): boolean;
};
type CheckResult = { outcome: 'ok' | 'paused' | 'failed'; session: string | null };

async function check(
  deps: InboxCheckDeps,
  retry = true,
  active = () => true,
  onStart = () => {},
): Promise<CheckResult> {
  const session = deps.session();
  const failed: CheckResult = { outcome: 'failed', session };
  if (!active() || deps.visible?.() === false) return failed;
  const api = deps.api();
  if (!api) return failed;
  let reply: Awaited<ReturnType<AgentApi['inbox']>>;
  try {
    onStart();
    reply = await api.inbox();
  } catch {
    reply = { ok: false, reason: 'offline' };
  }
  if (!active() || !sameOwner(api.owner)) return failed;
  // 세션이 바뀐 요청의 성공과 실패를 모두 버리고, 한 번만 바로 다시 확인해요.
  if (deps.session() !== session) return retry ? check(deps, false, active, onStart) : failed;
  if (!reply.ok) {
    if (reply.reason === 'auth' || reply.reason === 'not-allowed') {
      deps.schedule();
      return { outcome: 'paused', session };
    }
    return failed;
  }
  const local = readAgentInboxLocal(deps.storage, api.owner);
  const ids = reply.data.items.map((item) => item.id);
  if (ids.some((id) => !local.notified.includes(id))) deps.notify(ids.length);
  writeAgentInboxLocal(deps.storage, { ...local, notified: ids });
  await checkChanges(deps, api, session, active);
  return { outcome: 'ok', session };
}

/** 변경 기록을 읽어 알리지 않은 변경이 있으면 알려요. 실패해도 받은함 확인에는 영향이 없어요. */
async function checkChanges(
  deps: InboxCheckDeps,
  api: AgentApi,
  session: string | null,
  active: () => boolean,
): Promise<void> {
  try {
    const reply = await api.changes();
    if (!active() || !sameOwner(api.owner) || deps.session() !== session) return;
    if (!reply?.ok || !Array.isArray(reply.data.changes)) return;
    const local = readAgentInboxLocal(deps.storage, api.owner);
    const ids = reply.data.changes.map((change) => change.id);
    const fresh = reply.data.changes.filter(
      (change) => change.undoneAt === null && !local.notifiedChanges.includes(change.id),
    );
    if (fresh.length > 0) deps.notifyChanges(fresh.length);
    writeAgentInboxLocal(deps.storage, { ...local, notifiedChanges: ids });
  } catch {
    // 변경 기록을 읽지 못하면 다음 확인 때 다시 시도해요.
  }
}

/** 새 항목만 알리고 인증 실패면 해당 요청의 세션에서 확인을 멈춰요. */
export async function checkInboxOnce(deps: InboxCheckDeps): Promise<CheckResult['outcome']> {
  return (await check(deps)).outcome;
}

/** 자체 타이머 없이 동기화가 끝날 때만 받은함을 확인해요. */
export function attachInboxCheck(
  engine: { onRunFinished(l: (s: { phase: string }) => void): () => void },
  deps: InboxCheckDeps,
  current: () => { phase: string },
): () => void {
  let active = true;
  let running = false;
  let owner: string | null | undefined;
  let lastCheckAt: number | undefined;
  let pausedSession: string | null | undefined;
  const run = (status: { phase: string }) => {
    if (
      !active ||
      running ||
      (status.phase !== 'synced' && status.phase !== 'conflict') ||
      deps.visible?.() === false
    )
      return;
    const api = deps.api();
    if (api?.owner !== owner) {
      owner = api?.owner;
      lastCheckAt = undefined;
      pausedSession = undefined;
    }
    if (!api) return;
    if (pausedSession !== undefined) {
      if (deps.session() === pausedSession) return;
      pausedSession = undefined;
      lastCheckAt = undefined;
    }
    const now = deps.now();
    if (lastCheckAt !== undefined && now - lastCheckAt < INBOX_CHECK_GAP_MS) return;
    lastCheckAt = now;
    running = true;
    void check(
      deps,
      true,
      () => active,
      () => {
        lastCheckAt = deps.now();
      },
    )
      .then((result) => {
        if (result.outcome === 'paused') pausedSession = result.session;
      })
      .catch(() => {})
      .finally(() => {
        running = false;
      });
  };
  const off = engine.onRunFinished(run);
  run(current());
  return () => {
    active = false;
    off();
  };
}

let started: Promise<void> | undefined;
export async function startInboxCheck(): Promise<void> {
  if (started) return started;
  let api = createAgentApi();
  if (!api) return;
  started = (async () => {
    const storage = getSharedSyncStorage();
    const engine = (await loadSyncEngine()).ensureLibrarySyncEngine();
    attachInboxCheck(
      engine,
      {
        api: () => {
          if (api?.owner !== readSyncMeta(storage).userId) api = createAgentApi();
          return api;
        },
        storage,
        now: Date.now,
        notify: (count) =>
          toast(`AI가 보낸 일정 ${count}개`, {
            action: { label: '보기', onClick: openInboxDialog },
          }),
        notifyChanges: (count) =>
          toast(`AI가 보관함을 바꿨어요 ${count}건`, {
            action: { label: '기록 보기', onClick: openChangesDialog },
          }),
        session: () => readSession(storage)?.sessionId ?? null,
        schedule: () => engine.schedule('manual'),
        visible: () => document.visibilityState !== 'hidden',
      },
      () => getDefaultStore().get(syncStatusAtom),
    );
  })().catch((error: unknown) => {
    started = undefined;
    throw error;
  });
  return started;
}

export async function discardInboxItem(id: string, owner: string | null): Promise<boolean> {
  if (!sameOwner(owner)) return false;
  const api = createAgentApi();
  if (!api || api.owner !== owner) return false;
  try {
    const result = await api.discard(id);
    return result.ok || result.reason === 'not-found';
  } catch {
    return false;
  }
}

export function openInboxDialog(): void {
  getDefaultStore().set(agentInboxOpenAtom, true);
}

export function openChangesDialog(): void {
  getDefaultStore().set(agentChangesOpenAtom, true);
}
