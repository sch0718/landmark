import type { SyncApi } from 'src/services/library-sync/api';
import { getSharedSyncApi, getSharedSyncStorage } from 'src/services/library-sync/shared-api';
import { readSession, readSyncMeta } from 'src/services/library-sync/storage';
import { toBackupFailure } from 'src/services/server-backup/api';

export type AgentFailure =
  | 'auth'
  | 'not-allowed'
  | 'offline'
  | 'off'
  | 'limit'
  | 'too-many'
  | 'not-found'
  | 'invalid'
  | 'server';
export type AgentResult<T> = { ok: true; data: T } | { ok: false; reason: AgentFailure };
export type AgentTokenView = {
  id: string;
  name: string;
  scopes: ('inbox:write' | 'share:create' | 'library:read' | 'library:write')[];
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};
export type InboxItemView = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  places: number;
  from: string | null;
  createdAt: number;
  expiresAt: number;
};
export type AgentChangeView = {
  id: string;
  tokenId: string;
  tokenName: string | null;
  requestId: string;
  kind: string;
  itemId: string;
  beforeRev: number;
  afterRev: number;
  label: string;
  at: number;
  undoneAt: number | null;
};
export type UndoStatus = { id: string; status: string };
export type UndoInput = { ids: string[] } | { requestId: string };
export type AgentApi = {
  owner: string | null;
  tokens(): Promise<
    AgentResult<{
      enabled: boolean;
      canCreate: boolean;
      maxActive: number;
      tokens: AgentTokenView[];
    }>
  >;
  issue(input: { name: string; scopes: AgentTokenView['scopes'] }): Promise<
    AgentResult<{
      token: string;
      id: string;
      name: string;
      scopes: AgentTokenView['scopes'];
      expiresAt: number;
    }>
  >;
  revoke(id: string): Promise<AgentResult<null>>;
  inbox(): Promise<AgentResult<{ items: InboxItemView[] }>>;
  item(id: string): Promise<AgentResult<{ id: string; data: string }>>;
  discard(id: string): Promise<AgentResult<null>>;
  changes(): Promise<AgentResult<{ changes: AgentChangeView[] }>>;
  /** 한 번에 처리되지 않은 나머지(`more`)는 끝까지 이어서 불러 결과를 합쳐요. */
  undo(input: UndoInput): Promise<AgentResult<{ results: UndoStatus[] }>>;
};

/** `more`가 참인 동안 같은 요청을 반복해 결과를 합쳐요. 무한 반복을 막으려고 횟수에 상한을 둬요. */
const UNDO_MAX_ROUNDS = 50;

export function toAgentFailure(fail: {
  kind: string;
  code?: string;
  status?: number;
}): AgentFailure {
  const reason = toBackupFailure(fail);
  return reason === 'changed' ? 'server' : reason === 'too-large' ? 'invalid' : reason;
}

/** 모든 요청을 API를 만들 때의 계정에 묶어요. 설정이 없으면 null을 돌려줘요. */
export function createAgentApi(api?: Pick<SyncApi, 'client'> | null): AgentApi | null {
  const sync = api === undefined ? getSharedSyncApi() : api;
  if (sync === null) return null;
  const { client } = sync;
  const owner = readSyncMeta(getSharedSyncStorage()).userId;
  async function send<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: object,
  ): Promise<AgentResult<T>> {
    const options = {
      ...(body === undefined ? {} : { body }),
      ...(owner === null ? {} : { headers: { 'X-Landmark-Backup-User': owner } }),
    };
    const result =
      Object.keys(options).length === 0
        ? await client.send<T>(method, path)
        : await client.send<T>(method, path, options);
    if (result.ok) return { ok: true, data: result.data };
    // 발급 경로의 409는 토큰 개수 초과뿐이고 클라이언트가 오류 코드를 버려요.
    const reason =
      path === '/v1/agent/tokens' &&
      method === 'POST' &&
      result.kind === 'server' &&
      result.status === 409
        ? 'too-many'
        : toAgentFailure(result);
    return { ok: false, reason };
  }
  async function remove(path: string): Promise<AgentResult<null>> {
    const result = await send('DELETE', path);
    return result.ok ? { ok: true, data: null } : result;
  }
  async function undo(input: UndoInput): Promise<AgentResult<{ results: UndoStatus[] }>> {
    const results: UndoStatus[] = [];
    for (let round = 0; round < UNDO_MAX_ROUNDS; round += 1) {
      const page = await send<{ results: UndoStatus[]; more?: boolean }>(
        'POST',
        '/v1/agent/changes/undo',
        input,
      );
      if (!page.ok) return page;
      results.push(...page.data.results);
      if (page.data.more !== true) break;
    }
    return { ok: true, data: { results } };
  }
  return {
    owner,
    tokens: () => send('GET', '/v1/agent/tokens'),
    issue: (body) => send('POST', '/v1/agent/tokens', body),
    revoke: (id) => remove('/v1/agent/tokens/' + encodeURIComponent(id)),
    inbox: () => send('GET', '/v1/agent/inbox'),
    item: (id) => send('GET', '/v1/agent/inbox/' + encodeURIComponent(id)),
    discard: (id) => remove('/v1/agent/inbox/' + encodeURIComponent(id)),
    changes: () => send('GET', '/v1/agent/changes'),
    undo,
  };
}

/** 같은 계정이고 저장된 세션이 있는지 확인해요. */
export function sameOwner(owner: string | null): boolean {
  const storage = getSharedSyncStorage();
  return owner !== null && readSyncMeta(storage).userId === owner && readSession(storage) !== null;
}
