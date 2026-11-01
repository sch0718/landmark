import { stableStringify } from 'src/domain/library-sync/items';
import type { TripErrorCode, TripIssue } from './errors';
import type { TripPlan } from './plan-schema';

export type AgentClientDeps = { fetch: typeof fetch; timeoutMs?: number };
export type AgentReply<T> = { ok: true; status: number; data: T } | { ok: false; issue: TripIssue };
const messages = {
  unauthorized: '토큰이 올바르지 않아요. AI 연결에서 새로 만들어 주세요',
  'token-expired': '토큰이 만료됐어요. AI 연결에서 새로 만들어 주세요',
  'token-revoked': '토큰이 철회됐어요. AI 연결에서 새로 만들어 주세요',
  'not-allowed': '이 계정은 AI 연결을 쓸 수 없어요',
  scope: '이 토큰에 필요한 권한이 없어요',
  'delete-token': '링크 삭제 권한을 확인하지 못했어요',
  'inbox-full': '앱에서 받은 일정을 가져오거나 버려 주세요',
  'rate-limited': '하루 사용 한도를 넘었어요. 나중에 다시 해 주세요',
  off: '지금은 AI 연결을 쓸 수 없어요',
  config: '서버의 AI 연결 설정이 빠져 있어요',
  'old-server': '서버가 이 기능을 몰라요(옛 버전)',
  internal: 'CLI가 만든 문서를 서버가 거절했어요',
  offline: '서버에 연결하지 못했어요',
  timeout: '서버가 제때 응답하지 않아요',
  server: '서버가 요청을 처리하지 못했어요',
} satisfies Partial<Record<TripErrorCode, string>>;
const issue = (code: keyof typeof messages): TripIssue => ({
  path: '',
  code,
  message: messages[code],
});

export function createAgentClient(app: string, token: string, deps: AgentClientDeps) {
  async function request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<AgentReply<T>> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<AgentReply<T>>((resolve) => {
      timer = setTimeout(() => {
        resolve({ ok: false, issue: issue('timeout') });
        controller.abort();
      }, deps.timeoutMs ?? 15_000);
    });
    const send = async (): Promise<AgentReply<T>> => {
      try {
        const response = await deps.fetch(app + '/api/agent/v1' + path, {
          method,
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await response.text();
        let value: unknown;
        try {
          value = JSON.parse(text);
        } catch {
          value = null;
        }
        if (
          method === 'DELETE' &&
          path.startsWith('/share/') &&
          response.status === 404 &&
          value !== null &&
          typeof value === 'object' &&
          'error' in value &&
          value.error === 'not-found'
        )
          return { ok: true, status: 404, data: null as T };
        if (response.status === 204) return { ok: true, status: 204, data: null as T };
        if (!response.ok) return { ok: false, issue: toIssue(response.status, value) };
        if (method === 'DELETE') return { ok: false, issue: issue('server') };
        if (value === null) return { ok: false, issue: issue('server') };
        return { ok: true, status: response.status, data: value as T };
      } catch {
        return { ok: false, issue: issue('offline') };
      }
    };
    try {
      return await Promise.race([send(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    whoami: () =>
      request<{ name: string; scopes: string[]; expiresAt: number; provider: string }>('/whoami'),
    sendInbox: (body: { v: 1; key: string; d: string }) =>
      request<{ id: string; expiresAt: number; created: boolean }>('/inbox', 'POST', body),
    createShare: (body: { body: string; kind: 'trip'; keepUntil?: string; deleteToken: string }) =>
      request<{ id: string; expiresAt: string; created: boolean }>('/share', 'POST', body),
    deleteShare: (id: string, deleteToken: string) =>
      request<null>('/share/' + encodeURIComponent(id), 'DELETE', undefined, {
        'X-Delete-Token': deleteToken,
      }),
  };
}
/** 서버가 보낸 문구는 쓰지 않고 상태와 알려진 코드만 옮긴다. */
export function toIssue(status: number, body: unknown): TripIssue {
  if (status === 404) return issue('old-server');
  const code =
    body !== null && typeof body === 'object' && 'error' in body ? body.error : undefined;
  const allowed: Record<number, readonly string[]> = {
    401: ['unauthorized', 'token-expired', 'token-revoked'],
    403: ['not-allowed', 'scope', 'delete-token'],
    409: ['inbox-full'],
    429: ['rate-limited'],
    503: ['off', 'config'],
  };
  if (status === 422 && code === 'invalid') {
    const reason =
      body !== null && typeof body === 'object' && 'reason' in body ? body.reason : undefined;
    const known = [
      'corrupt',
      'too-big',
      'too-many',
      'empty',
      'newer',
      'not-share',
      'not-trip',
      'title',
      'labels',
      'place-too-long',
      'leg-modes',
      'path',
      'import',
      'item-too-large',
    ];
    const result = issue('internal');
    return typeof reason === 'string' && known.includes(reason)
      ? { ...result, reason, message: `${result.message} (${reason})` }
      : result;
  }
  if (typeof code === 'string' && allowed[status]?.includes(code))
    return issue(code as keyof typeof messages);
  return issue('server');
}
export async function requestKey(
  plan: TripPlan,
  options: { includeMemo: boolean; noRoutes: boolean },
): Promise<string> {
  const bytes = new TextEncoder().encode(
    stableStringify([plan, options.includeMemo, options.noRoutes]),
  );
  return Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('base64url');
}
